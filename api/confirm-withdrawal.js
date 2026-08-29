import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

/*
 * =========================================================
 * USDTMZ — CONFIRM WITHDRAWAL
 * =========================================================
 *
 * POST /api/confirm-withdrawal
 *
 * Recebe:
 *
 * {
 *   "withdrawal_id": "WD-XXXX"
 * }
 *
 * Fluxo:
 *
 * PROCESSING
 *     ↓
 * consultar TX na TRON
 *     ↓
 * TX confirmado
 *     ↓
 * wallet_transactions = COMPLETED
 *     ↓
 * withdrawals = COMPLETED
 *     ↓
 * orders = USDT_SENT
 *
 * Se ainda não estiver confirmado:
 *
 * PROCESSING continua PROCESSING
 *
 * =========================================================
 */

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY;

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";


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
 * TX HASH
 * =========================================================
 */

function isValidTxHash(hash) {

  return /^[a-fA-F0-9]{64}$/.test(
    String(hash || "").trim()
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
    decimal.padEnd(6, "0");

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
      .padStart(6, "0");

  return `${whole}.${decimal}`;
}


/*
 * =========================================================
 * TRON API
 * =========================================================
 */

async function getTransaction(txHash) {

  const response =
    await fetch(
      `${TRON_HOST}/wallet/gettransactionbyid`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "TRON-PRO-API-KEY":
            TRONGRID_API_KEY
        },

        body:
          JSON.stringify({
            value:
              txHash
          })
      }
    );


  if (!response.ok) {

    throw new Error(
      `TRON API HTTP ${response.status}`
    );
  }


  return response.json();
}


/*
 * =========================================================
 * TRON CONFIRMAÇÃO
 * =========================================================
 */

async function getTransactionInfo(txHash) {

  const response =
    await fetch(
      `${TRON_HOST}/wallet/gettransactioninfobyid`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "TRON-PRO-API-KEY":
            TRONGRID_API_KEY
        },

        body:
          JSON.stringify({
            value:
              txHash
          })
      }
    );


  if (!response.ok) {

    throw new Error(
      `TRON INFO API HTTP ${response.status}`
    );
  }


  return response.json();
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
      !TRONGRID_API_KEY
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
     * LOCALIZAR RETIRADA
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
          order_id,
          created_at,
          updated_at

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
     * JÁ COMPLETADA
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
          confirmed: true,
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
     * PRECISA ESTAR PROCESSING
     * -----------------------------------------------------
     */

    if (
      String(
        withdrawal.status
      ).toUpperCase() !==
      "PROCESSING"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          confirmed: false,
          error:
            "A retirada precisa estar PROCESSING para ser confirmada.",

          status:
            withdrawal.status
        }
      );
    }


    /*
     * -----------------------------------------------------
     * TX HASH
     * -----------------------------------------------------
     */

    const txHash =
      String(
        withdrawal.tx_hash ||
        ""
      ).trim();


    if (
      !isValidTxHash(txHash)
    ) {

      return json(
        res,
        409,
        {
          success: false,
          confirmed: false,
          error:
            "A retirada ainda não possui um TX hash válido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR DESTINO
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
            "Endereço de destino inválido."
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
            "Asset inválido."
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
            "Rede inválida."
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
            "Valor USDT inválido."
        }
      );
    }


    const amountFormatted =
      formatUsdtAmount(
        rawAmount
      );


    /*
     * -----------------------------------------------------
     * CONSULTAR TRON
     * -----------------------------------------------------
     */

    const transaction =
      await getTransaction(
        txHash
      );


    /*
     * TX ainda não encontrada
     * -----------------------------------------------------
     */

    if (
      !transaction ||
      !transaction.txID
    ) {

      return json(
        res,
        200,
        {
          success: true,
          confirmed: false,

          message:
            "Transação ainda não encontrada na TRON.",

          withdrawal: {

            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status,

            tx_hash:
              txHash

          }
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CONSULTAR RESULTADO
     * -----------------------------------------------------
     */

    const transactionInfo =
      await getTransactionInfo(
        txHash
      );


    /*
     * -----------------------------------------------------
     * VERIFICAR RESULTADO TRON
     * -----------------------------------------------------
     */

    const result =
      String(
        transactionInfo?.receipt?.result ||
        ""
      ).toUpperCase();


    /*
     * FALHA
     * -----------------------------------------------------
     */

    if (
      result &&
      result !== "SUCCESS"
    ) {

      await sql`

        UPDATE withdrawals

        SET

          status =
            'FAILED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'PROCESSING'

          AND tx_hash =
            ${txHash}

      `;


      return json(
        res,
        200,
        {
          success: false,
          confirmed: false,

          status:
            "FAILED",

          tx_hash:
            txHash,

          error:
            "A transação TRON foi confirmada como falhada."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * AINDA SEM RECEIPT FINAL
     * -----------------------------------------------------
     */

    if (
      !result
    ) {

      return json(
        res,
        200,
        {
          success: true,
          confirmed: false,

          message:
            "A transação existe, mas ainda aguarda confirmação.",

          withdrawal: {

            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status,

            tx_hash:
              txHash

          }
        }
      );
    }


    /*
     * =====================================================
     * TRANSAÇÃO CONFIRMADA
     * =====================================================
     */


    /*
     * -----------------------------------------------------
     * LOCALIZAR WALLET
     * -----------------------------------------------------
     */

    const wallets =
      await sql`

        SELECT

          id,
          wallet_address,
          network,
          asset,
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
        500,
        {
          success: false,
          error:
            "Carteira USDT Mainnet não encontrada."
        }
      );
    }


    const wallet =
      wallets[0];


    /*
     * -----------------------------------------------------
     * WALLET TRANSACTION — IDEMPOTÊNCIA
     * -----------------------------------------------------
     */

    const existingTransaction =
      await sql`

        SELECT

          id,
          wallet_id,
          order_id,
          tx_hash,
          type,
          asset,
          amount,
          network,
          status,
          created_at

        FROM wallet_transactions

        WHERE tx_hash =
          ${txHash}

        LIMIT 1

      `;


    /*
     * -----------------------------------------------------
     * CRIAR WALLET TRANSACTION
     * -----------------------------------------------------
     */

    if (
      existingTransaction.length === 0
    ) {

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

        VALUES (

          ${wallet.id},

          ${withdrawal.order_id},

          ${txHash},

          'WITHDRAWAL',

          ${ASSET},

          ${amountFormatted},

          ${NETWORK},

          'COMPLETED',

          NOW()

        )

      `;
    }


    /*
     * -----------------------------------------------------
     * WITHDRAWAL → COMPLETED
     * -----------------------------------------------------
     */

    const completed =
      await sql`

        UPDATE withdrawals

        SET

          status =
            'COMPLETED',

          tx_hash =
            ${txHash},

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'PROCESSING'

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


    /*
     * -----------------------------------------------------
     * ORDER → USDT_SENT
     * -----------------------------------------------------
 */

    if (
      withdrawal.order_id
    ) {

      await sql`

        UPDATE orders

        SET

          blockchain_tx_hash =
            ${txHash},

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
          ${withdrawal.order_id}

      `;
    }


    /*
     * -----------------------------------------------------
     * RESPOSTA
     * -----------------------------------------------------
 */

    const finalWithdrawal =
      completed.length > 0
        ? completed[0]
        : withdrawal;


    return json(
      res,
      200,
      {
        success: true,

        confirmed: true,

        message:
          "Transação TRON confirmada com sucesso.",

        withdrawal: {

          withdrawal_id:
            finalWithdrawal.withdrawal_id,

          destination_address:
            finalWithdrawal.destination_address,

          amount:
            finalWithdrawal.amount,

          asset:
            finalWithdrawal.asset,

          network:
            finalWithdrawal.network,

          status:
            finalWithdrawal.status,

          tx_hash:
            finalWithdrawal.tx_hash,

          order_id:
            finalWithdrawal.order_id

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ CONFIRM WITHDRAWAL ERROR:",
      error?.message ||
      error
    );


    return json(
      res,
      500,
      {
        success: false,
        confirmed: false,
        error:
          "Erro interno ao confirmar retirada."
      }
    );
  }
}
