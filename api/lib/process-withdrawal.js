import { neon } from "@neondatabase/serverless";
import { TronWeb } from "tronweb";

const TRON_FULL_HOST = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const MAX_WITHDRAWAL_USDT = 1000000;

// 100 TRX em SUN como limite máximo de execução.
// Não é um pagamento fixo; é o fee_limit máximo permitido.
const FEE_LIMIT = 100_000_000;


function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}


function parseUsdtAmount(value) {

  const text =
    String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const parts =
    text.split(".");

  const whole =
    parts[0];

  const decimal =
    parts[1] || "";

  const padded =
    decimal.padEnd(
      USDT_DECIMALS,
      "0"
    );

  return (
    BigInt(whole) * 1_000_000n +
    BigInt(padded)
  );
}


function formatUsdtAmount(raw) {

  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (value % 1_000_000n)
      .toString()
      .padStart(6, "0");

  return `${whole}.${decimal}`;
}


export async function processWithdrawal(
  withdrawalId
) {

  /*
   * =========================
   * DATABASE
   * =========================
   */

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL não configurada."
    );
  }

  const sql =
    neon(
      process.env.DATABASE_URL
    );


  /*
   * =========================
   * BUSCAR WITHDRAWAL
   * =========================
   */

  const withdrawals =
    await sql`
      SELECT
        id,
        withdrawal_id,
        order_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash
      FROM withdrawals
      WHERE withdrawal_id =
        ${withdrawalId}
      LIMIT 1
    `;


  if (withdrawals.length === 0) {

    throw new Error(
      "Withdrawal não encontrado."
    );

  }


  const withdrawal =
    withdrawals[0];


  /*
   * =========================
   * EVITAR DUPLICAÇÃO
   * =========================
   */

  if (
    withdrawal.status === "SENT" ||
    withdrawal.status === "CONFIRMED"
  ) {

    return {
      alreadyProcessed: true,
      withdrawal
    };

  }


  if (
    withdrawal.status !== "PENDING"
  ) {

    throw new Error(
      `Withdrawal está no estado ${withdrawal.status}.`
    );

  }


  /*
   * =========================
   * ASSET
   * =========================
   */

  if (
    String(
      withdrawal.asset
    ).toUpperCase() !== "USDT"
  ) {

    throw new Error(
      "O asset do withdrawal não é USDT."
    );

  }


  /*
   * =========================
   * NETWORK
   * =========================
   */

  if (
    String(
      withdrawal.network
    ).toLowerCase() !==
    "tron mainnet"
  ) {

    throw new Error(
      "A rede do withdrawal não é TRON Mainnet."
    );

  }


  /*
   * =========================
   * DESTINO
   * =========================
   */

  const destination =
    String(
      withdrawal.destination_address ||
      ""
    ).trim();


  if (
    !isValidTronAddress(
      destination
    )
  ) {

    throw new Error(
      "Endereço TRON de destino inválido."
    );

  }


  /*
   * =========================
   * VALOR
   * =========================
   */

  const rawAmount =
    parseUsdtAmount(
      withdrawal.amount
    );


  if (
    rawAmount === null ||
    rawAmount <= 0n
  ) {

    throw new Error(
      "Valor USDT inválido."
    );

  }


  const maxRaw =
    BigInt(
      MAX_WITHDRAWAL_USDT
    ) *
    1_000_000n;


  if (
    rawAmount > maxRaw
  ) {

    throw new Error(
      "Valor excede o limite máximo permitido."
    );

  }


  /*
   * =========================
   * CHAVE PRIVADA
   * =========================
   */

  const privateKey =
    String(
      process.env.TRON_PRIVATE_KEY ||
      ""
    ).trim();


  if (!privateKey) {

    throw new Error(
      "TRON_PRIVATE_KEY não configurada."
    );

  }


  /*
   * =========================
   * TRONWEB
   * =========================
   */

  const tronWeb =
    new TronWeb({
      fullHost:
        TRON_FULL_HOST,
      privateKey
    });


  /*
   * =========================
   * ENDEREÇO DA CHAVE
   * =========================
   */

  const senderAddress =
    tronWeb.defaultAddress.base58;


  if (
    !isValidTronAddress(
      senderAddress
    )
  ) {

    throw new Error(
      "A carteira da chave privada é inválida."
    );

  }


  /*
   * =========================
   * CARTEIRA PRINCIPAL
   * =========================
   */

  const wallets =
    await sql`
      SELECT
        id,
        wallet_address
      FROM wallets
      WHERE network =
        'TRON Mainnet'
        AND asset = 'USDT'
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;


  if (wallets.length === 0) {

    throw new Error(
      "Nenhuma carteira TRON Mainnet configurada."
    );

  }


  const configuredWallet =
    String(
      wallets[0].wallet_address ||
      ""
    ).trim();


  if (
    configuredWallet.toLowerCase() !==
    senderAddress.toLowerCase()
  ) {

    throw new Error(
      "A TRON_PRIVATE_KEY não corresponde à carteira principal configurada."
    );

  }


  /*
   * =========================
   * BLOQUEAR WITHDRAWAL
   * =========================
   */

  const locked =
    await sql`
      UPDATE withdrawals
      SET
        status = 'PROCESSING',
        updated_at = NOW()
      WHERE withdrawal_id =
        ${withdrawalId}
        AND status = 'PENDING'
      RETURNING *
    `;


  if (locked.length === 0) {

    throw new Error(
      "O withdrawal já está sendo processado."
    );

  }


  try {

    /*
     * =========================
     * CONTRATO USDT
     * =========================
     */

    const contract =
      await tronWeb
        .contract()
        .at(
          USDT_CONTRACT
        );


    /*
     * =========================
     * SALDO USDT
     * =========================
     */

    const balanceRaw =
      await contract
        .balanceOf(
          senderAddress
        )
        .call();


    const balance =
      BigInt(
        String(balanceRaw)
      );


    if (
      balance < rawAmount
    ) {

      throw new Error(
        `Saldo USDT insuficiente. Saldo atual: ${formatUsdtAmount(balance)} USDT. Necessário: ${formatUsdtAmount(rawAmount)} USDT.`
      );

    }


    /*
     * =========================
     * SALDO TRX
     * =========================
     */

    const trxBalance =
      await tronWeb.trx.getBalance(
        senderAddress
      );


    if (
      BigInt(
        String(trxBalance)
      ) <= 0n
    ) {

      throw new Error(
        "A carteira não possui TRX para executar a transação."
      );

    }


    /*
     * =========================
     * CONSTRUIR TRANSFERÊNCIA
     * =========================
     */

    const transaction =
      await tronWeb.transactionBuilder
        .triggerSmartContract(
          USDT_CONTRACT,
          "transfer(address,uint256)",
          {
            feeLimit:
              FEE_LIMIT,
            callValue: 0
          },
          [
            {
              type: "address",
              value:
                destination
            },
            {
              type: "uint256",
              value:
                rawAmount.toString()
            }
          ],
          senderAddress
        );


    if (
      !transaction ||
      !transaction.transaction
    ) {

      throw new Error(
        "Não foi possível construir a transação USDT."
      );

    }


    /*
     * =========================
     * ASSINAR
     * =========================
     */

    const signed =
      await tronWeb.trx.sign(
        transaction.transaction,
        privateKey
      );


    /*
     * =========================
     * TRANSMITIR
     * =========================
     */

    const broadcast =
      await tronWeb.trx.sendRawTransaction(
        signed
      );


    if (
      !broadcast ||
      broadcast.result !== true
    ) {

      throw new Error(
        `A TRON recusou a transação: ${JSON.stringify(broadcast)}`
      );

    }


    const txHash =
      broadcast.txid ||
      signed.txID;


    if (!txHash) {

      throw new Error(
        "Transação transmitida sem TXID."
      );

    }


    /*
     * =========================
     * SALVAR TXID
     * =========================
     */

    const updated =
      await sql`
        UPDATE withdrawals
        SET
          status = 'SENT',
          tx_hash = ${txHash},
          updated_at = NOW()
        WHERE withdrawal_id =
          ${withdrawalId}
        RETURNING *
      `;


    /*
     * =========================
     * ATUALIZAR PEDIDO
     * =========================
     */

    if (
      withdrawal.order_id
    ) {

      await sql`
        UPDATE orders
        SET
          blockchain_tx_hash =
            ${txHash},
          wallet_address =
            ${destination},
          status =
            'PROCESSING',
          updated_at =
            NOW()
        WHERE order_id =
          ${withdrawal.order_id}
      `;

    }


    /*
     * =========================
     * RESULTADO
     * =========================
     */

    return {

      alreadyProcessed:
        false,

      txHash,

      amount:
        formatUsdtAmount(
          rawAmount
        ),

      from:
        senderAddress,

      to:
        destination,

      withdrawal:
        updated[0]

    };


  } catch (error) {

    /*
     * =========================
     * MARCAR FALHA
     * =========================
     */

    await sql`
      UPDATE withdrawals
      SET
        status = 'FAILED',
        updated_at = NOW()
      WHERE withdrawal_id =
        ${withdrawalId}
        AND status =
          'PROCESSING'
    `;


    throw error;

  }

}
