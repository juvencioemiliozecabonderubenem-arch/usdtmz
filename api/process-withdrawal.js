import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

/*
 * =========================================================
 * USDTMZ — PROCESS WITHDRAWAL
 * =========================================================
 *
 * POST /api/process-withdrawal
 *
 * Fluxo:
 *
 * AUTHORIZED
 *     ↓
 * validar withdrawal
 *     ↓
 * validar carteira
 *     ↓
 * verificar USDT
 *     ↓
 * verificar TRX
 *     ↓
 * PROCESSING
 *     ↓
 * construir transferência TRC-20
 *     ↓
 * broadcast
 *     ↓
 * TX HASH
 *     ↓
 * wallet_transactions
 *     ↓
 * COMPLETED
 *
 * TABELAS UTILIZADAS:
 *
 * withdrawals
 * wallet_transactions
 * wallets
 * orders
 *
 * =========================================================
 */

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";

/*
 * Para impedir transmissão acidental.
 *
 * Só permitir broadcast quando:
 *
 * ENABLE_TRON_BROADCAST=true
 *
 * estiver configurado no Vercel.
 */
const ENABLE_TRON_BROADCAST =
  String(
    process.env.ENABLE_TRON_BROADCAST || ""
  ).toLowerCase() === "true";


/*
 * =========================================================
 * JSON
 * =========================================================
 */

function json(res, status, data) {

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(status)
    .json(data);
}


/*
 * =========================================================
 * TRON ADDRESS
 * =========================================================
 */

function isValidTronAddress(address) {

  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}


/*
 * =========================================================
 * USDT
 * =========================================================
 */

function parseUsdtAmount(value) {

  const text =
    String(value ?? "").trim();

  if (
    !/^\d+(\.\d{1,6})?$/.test(text)
  ) {
    return null;
  }

  const [
    whole,
    decimal = ""
  ] =
    text.split(".");

  const padded =
    decimal.padEnd(
      USDT_DECIMALS,
      "0"
    );

  const raw =
    BigInt(whole) *
      1_000_000n +
    BigInt(padded);

  if (raw <= 0n) {
    return null;
  }

  return raw;
}


function formatUsdtAmount(raw) {

  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (
      value %
      1_000_000n
    )
      .toString()
      .padStart(
        USDT_DECIMALS,
        "0"
      );

  return `${whole}.${decimal}`;
}


/*
 * =========================================================
 * PRIVATE KEY
 * =========================================================
 */

function getPrivateKey() {

  const key =
    String(
      process.env.TRON_PRIVATE_KEY || ""
    ).trim();

  if (!key) {
    throw new Error(
      "TRON_PRIVATE_KEY não configurada."
    );
  }

  /*
   * Aceita chave hexadecimal
   * com ou sem 0x.
   */

  const normalized =
    key.startsWith("0x")
      ? key.slice(2)
      : key;

  if (
    !/^[0-9a-fA-F]{64}$/.test(
      normalized
    )
  ) {
    throw new Error(
      "TRON_PRIVATE_KEY inválida."
    );
  }

  return normalized;
}


/*
 * =========================================================
 * TRONWEB
 * =========================================================
 */

function createTronWeb() {

  const privateKey =
    getPrivateKey();

  return new TronWeb({
    fullHost: TRON_HOST,
    privateKey
  });
}


/*
 * =========================================================
 * CONFIRMAR CARTEIRA DO SERVIDOR
 * =========================================================
 */

function getServerAddress(tronWeb) {

  const address =
    tronWeb.address.fromPrivateKey(
      getPrivateKey()
    );

  if (
    !isValidTronAddress(address)
  ) {
    throw new Error(
      "A chave privada não corresponde a um endereço TRON válido."
    );
  }

  return address;
}


/*
 * =========================================================
 * HANDLER
 * =========================================================
 */

export default async function handler(
  req,
  res
) {

  /*
   * -------------------------------------------------------
   * MÉTODO
   * -------------------------------------------------------
   */

  if (req.method !== "POST") {

    res.setHeader(
      "Allow",
      "POST"
    );

    return json(
      res,
      405,
      {
        success: false,
        error:
          "Método não permitido."
      }
    );
  }


  try {

    /*
     * -----------------------------------------------------
     * CONFIGURAÇÃO
     * -----------------------------------------------------
     */

    if (
      !process.env.DATABASE_URL
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "DATABASE_URL não configurada."
        }
      );
    }


    if (
      !process.env.TRONGRID_API_KEY
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRONGRID_API_KEY não configurada."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * DATABASE
     * -----------------------------------------------------
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * -----------------------------------------------------
     * BODY
     * -----------------------------------------------------
     *
     * Aceita:
     *
     * {
     *   "withdrawal_id": "WD-..."
     * }
     */

    const body =
      req.body || {};

    const withdrawalId =
      String(
        body.withdrawal_id ||
        ""
      ).trim();


    if (!withdrawalId) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "withdrawal_id é obrigatório."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * LOCALIZAR WITHDRAWAL
     * -----------------------------------------------------
     */

    const withdrawals =
      await sql`

        SELECT

          id,
          withdrawal_id,
          destination_address,
          asset,
          network,
          amount,
          status,
          tx_hash,
          created_at,
          updated_at,
          order_id

        FROM withdrawals

        WHERE withdrawal_id =
          ${withdrawalId}

        LIMIT 1

      `;


    if (
      withdrawals.length === 0
    ) {

      return json(
        res,
        404,
        {
          success: false,
          error:
            "Retirada não encontrada."
        }
      );
    }


    const withdrawal =
      withdrawals[0];


    /*
     * -----------------------------------------------------
     * SE JÁ ESTÁ COMPLETED
     * -----------------------------------------------------
     */

    if (
      String(
        withdrawal.status
      ).toUpperCase() ===
      "COMPLETED"
    ) {

      return json(
        res,
        200,
        {
          success: true,
          already_completed: true,
          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,
            status:
              withdrawal.status,
            tx_hash:
              withdrawal.tx_hash
          }
        }
      );
    }


    /*
     * -----------------------------------------------------
     * SE JÁ POSSUI TX HASH
     * -----------------------------------------------------
     */

    if (
      withdrawal.tx_hash
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Esta retirada já possui TX hash e não pode ser transmitida novamente.",
          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,
            status:
              withdrawal.status,
            tx_hash:
              withdrawal.tx_hash
          }
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ESTADO OBRIGATÓRIO
     * -----------------------------------------------------
     */

    const currentStatus =
      String(
        withdrawal.status || ""
      ).toUpperCase();


    if (
      currentStatus !==
      "AUTHORIZED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "A retirada precisa estar AUTHORIZED antes do processamento.",
          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,
            status:
              withdrawal.status
          }
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR ASSET
     * -----------------------------------------------------
     */

    if (
      String(
        withdrawal.asset
      ).toUpperCase() !==
      ASSET
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Asset da retirada não é USDT."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR NETWORK
     * -----------------------------------------------------
     */

    if (
      String(
        withdrawal.network
      ) !==
      NETWORK
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "A retirada não está configurada para TRON Mainnet."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * DESTINO
     * -----------------------------------------------------
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

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Endereço TRON de destino inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALOR
     * -----------------------------------------------------
     */

    const rawAmount =
      parseUsdtAmount(
        withdrawal.amount
      );


    if (
      rawAmount === null
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Valor USDT da retirada inválido."
        }
      );
    }


    const amountFormatted =
      formatUsdtAmount(
        rawAmount
      );


    /*
     * -----------------------------------------------------
     * LOCALIZAR CARTEIRA
     * -----------------------------------------------------
     */

    const wallets =
      await sql`

        SELECT

          id,
          wallet_address,
          network,
          asset,
          balance,
          status

        FROM wallets

        WHERE network =
          ${NETWORK}

          AND asset =
          ${ASSET}

          AND status =
          'mainnet'

        ORDER BY id DESC

        LIMIT 1

      `;


    if (
      wallets.length === 0
    ) {

      return json(
        res,
        404,
        {
          success: false,
          error:
            "Carteira USDT TRON Mainnet não encontrada."
        }
      );
    }


    const wallet =
      wallets[0];


    const walletAddress =
      String(
        wallet.wallet_address ||
        ""
      ).trim();


    if (
      !isValidTronAddress(
        walletAddress
      )
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "Endereço da carteira USDT inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * TRONWEB
     * -----------------------------------------------------
     */

    const tronWeb =
      createTronWeb();


    /*
     * -----------------------------------------------------
     * CONFIRMAR DONO DA PRIVATE KEY
     * -----------------------------------------------------
     */

    const serverAddress =
      getServerAddress(
        tronWeb
      );


    if (
      serverAddress !==
      walletAddress
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "A TRON_PRIVATE_KEY não corresponde à carteira configurada no banco."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CONSULTAR TRX
     * -----------------------------------------------------
     */

    const trxSun =
      await tronWeb.trx.getBalance(
        walletAddress
      );


    const trxBalance =
      Number(trxSun) /
      1_000_000;


    /*
     * Não tentamos estimar um custo
     * falso. Apenas impedimos saldo
     * TRX zero/negativo.
     */

    if (
      !Number.isFinite(
        trxBalance
      ) ||
      trxBalance <= 0
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "A carteira não possui TRX suficiente para operar na TRON Mainnet.",
          trx_balance:
            trxBalance
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CONTRATO USDT
     * -----------------------------------------------------
     */

    const contract =
      await tronWeb.contract().at(
        USDT_CONTRACT
      );


    /*
     * -----------------------------------------------------
     * CONSULTAR USDT REAL NA BLOCKCHAIN
     * -----------------------------------------------------
     *
     * Não confiamos apenas em wallets.balance.
     * A blockchain é a fonte do saldo disponível
     * para a transmissão.
     */

    const blockchainRawBalance =
      await contract
        .balanceOf(walletAddress)
        .call();


    const blockchainBalance =
      BigInt(
        String(
          blockchainRawBalance
        )
      );


    /*
     * -----------------------------------------------------
     * SALDO USDT
     * -----------------------------------------------------
     */

    if (
      blockchainBalance <
      rawAmount
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Saldo USDT real insuficiente na carteira TRON.",
          blockchain_balance:
            formatUsdtAmount(
              blockchainBalance
            ),
          requested:
            amountFormatted
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VERIFICAR PROCESSAMENTO CONCORRENTE
     * -----------------------------------------------------
     */

    const processing =
      await sql`

        SELECT
          id,
          withdrawal_id,
          status,
          tx_hash

        FROM withdrawals

        WHERE withdrawal_id =
          ${withdrawalId}

        LIMIT 1

      `;


    if (
      processing.length === 0
    ) {

      return json(
        res,
        404,
        {
          success: false,
          error:
            "Retirada desapareceu durante a validação."
        }
      );
    }


    const latest =
      processing[0];


    if (
      String(
        latest.status || ""
      ).toUpperCase() !==
      "AUTHORIZED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "A retirada deixou de estar AUTHORIZED.",
          status:
            latest.status
        }
      );
    }


    /*
     * -----------------------------------------------------
     * MODO SEGURO
     * -----------------------------------------------------
     *
     * Sem ENABLE_TRON_BROADCAST=true:
     *
     * - nenhuma transação é assinada/transmitida
     * - nenhuma retirada é marcada COMPLETED
     *
     * Isso permite verificar toda a infraestrutura
     * antes de movimentar fundos reais.
     * -----------------------------------------------------
     */

    if (
      !ENABLE_TRON_BROADCAST
    ) {

      return json(
        res,
        200,
        {
          success: true,
          mode:
            "SAFE_VALIDATION",

          broadcasted:
            false,

          message:
            "Validação concluída. Broadcast TRON está desativado.",

          withdrawal: {

            withdrawal_id:
              withdrawal.withdrawal_id,

            destination_address:
              destination,

            amount:
              amountFormatted,

            asset:
              ASSET,

            network:
              NETWORK,

            status:
              withdrawal.status

          },

          wallet: {

            address:
              walletAddress,

            blockchain_usdt_balance:
              formatUsdtAmount(
                blockchainBalance
              ),

            trx_balance:
              trxBalance

          }

        }
      );
    }


    /*
     * =====================================================
     * BROADCAST REAL
     * =====================================================
     *
     * Só chega aqui quando:
     *
     * ENABLE_TRON_BROADCAST=true
     *
     * =====================================================
     */


    /*
     * -----------------------------------------------------
     * TRANSITION AUTHORIZED → PROCESSING
     * -----------------------------------------------------
     */

    const locked =
      await sql`

        UPDATE withdrawals

        SET

          status =
            'PROCESSING',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
          'AUTHORIZED'

          AND tx_hash IS NULL

        RETURNING

          id,
          withdrawal_id,
          destination_address,
          amount,
          status,
          order_id

      `;


    if (
      locked.length === 0
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "A retirada já está sendo processada por outra execução."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CONSTRUIR TRANSAÇÃO TRC-20
     * -----------------------------------------------------
     */

    let transaction;

    try {

      transaction =
        await contract.methods
          .transfer(
            destination,
            rawAmount.toString()
          )
          .send({

            feeLimit:
              100_000_000,

            callValue:
              0

          }, serverAddress);

    } catch (broadcastError) {

      console.error(
        "USDTMZ TRON BROADCAST ERROR:",
        broadcastError?.message ||
        broadcastError
      );


      /*
       * Se o broadcast falhar, volta
       * para AUTHORIZED para permitir
       * nova tentativa controlada.
       */

      await sql`

        UPDATE withdrawals

        SET

          status =
            'AUTHORIZED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
          'PROCESSING'

          AND tx_hash IS NULL

      `;


      return json(
        res,
        502,
        {
          success: false,
          error:
            "Falha ao transmitir a transação TRON.",
          details:
            broadcastError?.message ||
            null
        }
      );
    }


    /*
     * -----------------------------------------------------
     * TX HASH
     * -----------------------------------------------------
     */

    const txHash =
      typeof transaction === "string"
        ? transaction
        : transaction?.txid ||
          transaction?.transaction?.txID ||
          null;


    if (!txHash) {

      await sql`

        UPDATE withdrawals

        SET

          status =
            'AUTHORIZED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
          'PROCESSING'

          AND tx_hash IS NULL

      `;


      return json(
        res,
        502,
        {
          success: false,
          error:
            "A TRON não devolveu um TX hash válido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * GUARDAR TX HASH
     * -----------------------------------------------------
     */

    const updated =
      await sql`

        UPDATE withdrawals

        SET

          tx_hash =
            ${String(txHash)},

          status =
            'COMPLETED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
          'PROCESSING'

          AND tx_hash IS NULL

        RETURNING

          id,
          withdrawal_id,
          destination_address,
          asset,
          network,
          amount,
          status,
          tx_hash,
          order_id,
          created_at,
          updated_at

      `;


    if (
      updated.length === 0
    ) {

      /*
       * O broadcast aconteceu, mas
       * outro processo pode ter atualizado
       * a retirada.
       *
       * Nunca fazemos outro broadcast.
       */

      return json(
        res,
        409,
        {
          success: false,
          error:
            "A transação foi transmitida, mas a retirada já foi atualizada por outra execução.",
          tx_hash:
            String(txHash)
        }
      );
    }


    const completed =
      updated[0];


    /*
     * -----------------------------------------------------
     * WALLET TRANSACTION
     * -----------------------------------------------------
     */

    await sql`

      INSERT INTO wallet_transactions (

        wallet_id,
        order_id,
        tx_hash,
        type,
        asset,
        amount,
        network,
        status,
        created_at

      )

      SELECT

        ${wallet.id},

        ${completed.order_id},

        ${String(txHash)},

        'WITHDRAWAL',

        ${ASSET},

        ${amountFormatted},

        ${NETWORK},

        'COMPLETED',

        NOW()

      WHERE NOT EXISTS (

        SELECT 1

        FROM wallet_transactions

        WHERE tx_hash =
          ${String(txHash)}

      )

    `;


    /*
     * -----------------------------------------------------
     * ATUALIZAR ORDER
     * -----------------------------------------------------
     */

    if (
      completed.order_id
    ) {

      await sql`

        UPDATE orders

        SET

          blockchain_tx_hash =
            ${String(txHash)},

          status =
            CASE

              WHEN status =
                'COMPLETED'

              THEN status

              ELSE 'USDT_SENT'

            END,

          updated_at =
            NOW()

        WHERE order_id =
          ${completed.order_id}

      `;
    }


    /*
     * -----------------------------------------------------
     * RESPOSTA FINAL
     * -----------------------------------------------------
     */

    return json(
      res,
      200,
      {
        success: true,

        broadcasted:
          true,

        message:
          "Retirada USDT transmitida para a TRON.",

        withdrawal: {

          withdrawal_id:
            completed.withdrawal_id,

          destination_address:
            completed.destination_address,

          amount:
            completed.amount,

          asset:
            completed.asset,

          network:
            completed.network,

          status:
            completed.status,

          tx_hash:
            completed.tx_hash,

          order_id:
            completed.order_id

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ PROCESS WITHDRAWAL ERROR:",
      error?.message ||
      error
    );


    return json(
      res,
      500,
      {
        success: false,
        error:
          "Erro interno ao processar a retirada."
      }
    );
  }
}
