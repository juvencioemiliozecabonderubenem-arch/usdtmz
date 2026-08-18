import { neon } from "@neondatabase/serverless";
import { TronWeb } from "tronweb";

const TRON_FULL_HOST = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const MAX_WITHDRAWAL_USDT = 1000000;

const FEE_LIMIT = 100_000_000; // 100 TRX máximo de feeLimit

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function parseUsdtAmount(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] = text.split(".");

  const paddedDecimal =
    decimal.padEnd(USDT_DECIMALS, "0");

  return (
    BigInt(whole) * 1_000_000n +
    BigInt(paddedDecimal || "0")
  );
}

function formatUsdtAmount(raw) {
  const value = BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (value % 1_000_000n)
      .toString()
      .padStart(6, "0");

  return `${whole}.${decimal}`;
}

function getPrivateKey() {
  return String(
    process.env.TRON_PRIVATE_KEY || ""
  ).trim();
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    /*
     * =========================
     * DATABASE
     * =========================
     */

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);


    /*
     * =========================
     * WITHDRAWAL ID
     * =========================
     */

    const {
      withdrawal_id
    } = req.body || {};

    const withdrawalId =
      String(withdrawal_id || "").trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Informe o withdrawal_id."
      });
    }


    /*
     * =========================
     * BUSCAR WITHDRAWAL
     * =========================
     */

    const withdrawals = await sql`
      SELECT
        id,
        withdrawal_id,
        order_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash,
        created_at,
        updated_at
      FROM withdrawals
      WHERE withdrawal_id = ${withdrawalId}
      LIMIT 1
    `;

    if (withdrawals.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Withdrawal não encontrado."
      });
    }

    const withdrawal =
      withdrawals[0];


    /*
     * =========================
     * IMPEDIR DUPLICAÇÃO
     * =========================
     */

    if (
      withdrawal.status === "CONFIRMED" ||
      withdrawal.status === "SENT"
    ) {

      return res.status(409).json({
        success: false,
        error:
          "Este withdrawal já foi processado.",
        withdrawal
      });

    }


    /*
     * =========================
     * VALIDAR ASSET
     * =========================
     */

    if (
      String(withdrawal.asset)
        .toUpperCase() !== "USDT"
    ) {

      return res.status(400).json({
        success: false,
        error: "O asset do withdrawal não é USDT."
      });

    }


    /*
     * =========================
     * VALIDAR NETWORK
     * =========================
     */

    if (
      String(withdrawal.network)
        .toLowerCase() !==
      "tron mainnet"
    ) {

      return res.status(400).json({
        success: false,
        error:
          "A rede do withdrawal não é TRON Mainnet."
      });

    }


    /*
     * =========================
     * VALIDAR DESTINO
     * =========================
     */

    const destination =
      String(
        withdrawal.destination_address || ""
      ).trim();

    if (!isValidTronAddress(destination)) {

      return res.status(400).json({
        success: false,
        error:
          "Endereço TRON de destino inválido."
      });

    }


    /*
     * =========================
     * VALIDAR VALOR
     * =========================
     */

    const rawAmount =
      parseUsdtAmount(withdrawal.amount);

    if (
      rawAmount === null ||
      rawAmount <= 0n
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Valor USDT inválido."
      });

    }

    if (
      rawAmount >
      BigInt(MAX_WITHDRAWAL_USDT) *
      1_000_000n
    ) {

      return res.status(400).json({
        success: false,
        error:
          "O valor excede o limite máximo."
      });

    }


    /*
     * =========================
     * PRIVATE KEY
     * =========================
     *
     * Ainda não executar sem a chave.
     */

    const privateKey =
      getPrivateKey();

    if (!privateKey) {

      return res.status(503).json({
        success: false,
        ready: false,
        error:
          "TRON_PRIVATE_KEY ainda não configurada. O withdrawal foi validado, mas nenhuma transação foi enviada."
      });

    }


    /*
     * =========================
     * TRONWEB
     * =========================
     */

    const tronWeb =
      new TronWeb({
        fullHost: TRON_FULL_HOST,
        privateKey
      });


    /*
     * =========================
     * IDENTIFICAR SIGNER
     * =========================
     */

    const senderAddress =
      tronWeb.defaultAddress.base58;

    if (!isValidTronAddress(senderAddress)) {

      return res.status(500).json({
        success: false,
        error:
          "A carteira derivada da chave privada é inválida."
      });

    }


    /*
     * =========================
     * VERIFICAR CARTEIRA DO BANCO
     * =========================
     */

    const wallets = await sql`
      SELECT
        id,
        wallet_address
      FROM wallets
      WHERE network = 'TRON Mainnet'
        AND asset = 'USDT'
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;

    if (wallets.length === 0) {

      return res.status(404).json({
        success: false,
        error:
          "Nenhuma carteira TRON Mainnet configurada."
      });

    }

    const configuredWallet =
      String(
        wallets[0].wallet_address || ""
      ).trim();


    /*
     * A chave privada precisa controlar
     * exatamente a carteira configurada.
     */

    if (
      configuredWallet.toLowerCase() !==
      senderAddress.toLowerCase()
    ) {

      return res.status(409).json({
        success: false,
        error:
          "A chave privada configurada não corresponde à carteira TRON principal."
      });

    }


    /*
     * =========================
     * SALDO USDT ON-CHAIN
     * =========================
     */

    const contract =
      await tronWeb.contract().at(
        USDT_CONTRACT
      );

    const balanceRaw =
      await contract
        .balanceOf(senderAddress)
        .call();

    const balance =
      BigInt(String(balanceRaw));

    if (balance < rawAmount) {

      return res.status(400).json({
        success: false,
        error:
          "Saldo USDT insuficiente na carteira.",
        balance:
          formatUsdtAmount(balance),
        requested:
          formatUsdtAmount(rawAmount)
      });

    }


    /*
     * =========================
     * MARCAR PROCESSING
     * =========================
     */

    const processing =
      await sql`
        UPDATE withdrawals
        SET
          status = 'PROCESSING',
          updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
          AND status = 'PENDING'
        RETURNING
          withdrawal_id,
          order_id,
          destination_address,
          amount,
          status
      `;

    if (processing.length === 0) {

      return res.status(409).json({
        success: false,
        error:
          "O withdrawal já está sendo processado ou não está PENDING."
      });

    }


    /*
     * =========================
     * CONSTRUIR TRANSFERÊNCIA
     * =========================
     */

    const functionSelector =
      "transfer(address,uint256)";

    const parameters = [
      {
        type: "address",
        value: destination
      },
      {
        type: "uint256",
        value: rawAmount.toString()
      }
    ];

    const transaction =
      await tronWeb.transactionBuilder
        .triggerSmartContract(
          USDT_CONTRACT,
          functionSelector,
          {
            feeLimit: FEE_LIMIT,
            callValue: 0
          },
          parameters,
          senderAddress
        );


    if (
      !transaction ||
      !transaction.transaction
    ) {

      throw new Error(
        "Não foi possível construir a transação TRON."
      );

    }


    /*
     * =========================
     * ASSINAR
     * =========================
     */

    const signedTransaction =
      await tronWeb.trx.sign(
        transaction.transaction,
        privateKey
      );


    /*
     * =========================
     * BROADCAST
     * =========================
     */

    const broadcast =
      await tronWeb.trx.sendRawTransaction(
        signedTransaction
      );


    if (
      !broadcast ||
      broadcast.result !== true
    ) {

      console.error(
        "TRON BROADCAST ERROR:",
        broadcast
      );

      await sql`
        UPDATE withdrawals
        SET
          status = 'FAILED',
          updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
      `;

      return res.status(502).json({
        success: false,
        error:
          "A rede TRON recusou a transação.",
        details: broadcast
      });

    }


    /*
     * =========================
     * TXID
     * =========================
     */

    const txHash =
      broadcast.txid ||
      broadcast.transaction?.txID ||
      signedTransaction.txID;

    if (!txHash) {

      throw new Error(
        "A transação foi transmitida, mas o TXID não foi retornado."
      );

    }


    /*
     * =========================
     * GUARDAR TXID
     * =========================
     */

    const updatedWithdrawal =
      await sql`
        UPDATE withdrawals
        SET
          status = 'SENT',
          tx_hash = ${txHash},
          updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
        RETURNING
          withdrawal_id,
          order_id,
          destination_address,
          amount,
          status,
          tx_hash,
          updated_at
      `;


    /*
     * =========================
     * ATUALIZAR ORDER
     * =========================
     */

    if (withdrawal.order_id) {

      await sql`
        UPDATE orders
        SET
          blockchain_tx_hash = ${txHash},
          wallet_address = ${destination},
          updated_at = NOW()
        WHERE order_id = ${withdrawal.order_id}
      `;

    }


    /*
     * =========================
     * RESPOSTA
     * =========================
     */

    return res.status(200).json({

      success: true,

      message:
        "USDT enviado para a rede TRON.",

      withdrawal:
        updatedWithdrawal[0],

      transaction: {
        tx_hash: txHash,
        from: senderAddress,
        to: destination,
        asset: "USDT",
        network: "TRON Mainnet",
        amount:
          formatUsdtAmount(rawAmount)
      }

    });

  } catch (error) {

    console.error(
      "USDTMZ PROCESS WITHDRAWAL ERROR:",
      error
    );

    /*
     * Tentar marcar como FAILED.
     */

    try {

      if (
        process.env.DATABASE_URL &&
        req.body?.withdrawal_id
      ) {

        const sql =
          neon(process.env.DATABASE_URL);

        await sql`
          UPDATE withdrawals
          SET
            status = 'FAILED',
            updated_at = NOW()
          WHERE withdrawal_id =
            ${String(
              req.body.withdrawal_id
            ).trim()}
            AND status = 'PROCESSING'
        `;

      }

    } catch (dbError) {

      console.error(
        "USDTMZ WITHDRAWAL STATUS ERROR:",
        dbError
      );

    }

    return res.status(500).json({

      success: false,

      error:
        "Não foi possível processar o withdrawal."

    });

  }

}
