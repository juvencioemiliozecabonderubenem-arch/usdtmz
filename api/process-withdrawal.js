import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — MOTOR TRON / PROCESS WITHDRAWAL
 * =========================================================
 *
 * POST /api/process-withdrawal
 *
 * Fluxo:
 *
 * Pagar
 *   ↓
 * PAYMENT_CONFIRMED
 *   ↓
 * retirada AUTHORIZED
 *   ↓
 * verificar saldo USDT + TRX
 *   ↓
 * construir TRC-20
 *   ↓
 * assinar
 *   ↓
 * broadcast
 *   ↓
 * TX hash
 *   ↓
 * COMPLETED
 *
 * IMPORTANTE:
 * - PRIVATE KEY somente no Vercel Environment Variables.
 * - Nunca colocar a private key no GitHub.
 * - Não aceitar valor/endereço para transmissão diretamente
 *   do frontend.
 * - A retirada precisa existir na BD.
 * - Somente AUTHORIZED pode ser processada.
 */

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

/*
 * 100 TRX — limite máximo técnico da transação.
 * Não significa que serão necessariamente gastos 100 TRX.
 */
const FEE_LIMIT = 100_000_000;

/*
 * Evita processamentos gigantescos.
 */
const MAX_WITHDRAWAL_USDT = 1_000_000;

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRON_PRIVATE_KEY =
  process.env.TRON_PRIVATE_KEY;

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY;

const PROCESS_SECRET =
  process.env.WITHDRAWAL_API_SECRET;


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
 * USDT PARSER
 * =========================================================
 */

function parseUsdtAmount(value) {

  const text =
    String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
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

  const max =
    BigInt(MAX_WITHDRAWAL_USDT) *
    1_000_000n;

  if (raw > max) {
    return null;
  }

  return raw;
}


/*
 * =========================================================
 * FORMAT USDT
 * =========================================================
 */

function formatUsdtAmount(raw) {

  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (
      value % 1_000_000n
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
 * NORMALIZAR VALOR DA BD
 * =========================================================
 */

function databaseUsdtToRaw(value) {

  return (
    parseUsdtAmount(value) ||
    0n
  );
}


/*
 * =========================================================
 * REQUEST SECRET
 * =========================================================
 *
 * Protege o endpoint contra chamadas públicas.
 *
 * O frontend NÃO deve conhecer este segredo.
 * =========================================================
 */

function verifyProcessSecret(req) {

  if (!PROCESS_SECRET) {
    return false;
  }

  const received =
    req.headers[
      "x-withdrawal-secret"
    ];

  if (!received) {
    return false;
  }

  const receivedBuffer =
    Buffer.from(
      String(received),
      "utf8"
    );

  const expectedBuffer =
    Buffer.from(
      PROCESS_SECRET,
      "utf8"
    );

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}


/*
 * =========================================================
 * TRONWEB
 * =========================================================
 */

function createTronWeb() {

  if (!TRON_PRIVATE_KEY) {
    throw new Error(
      "TRON_PRIVATE_KEY não configurada."
    );
  }

  const fullHost =
    TRON_HOST;

  const headers =
    TRONGRID_API_KEY
      ? {
          "TRON-PRO-API-KEY":
            TRONGRID_API_KEY
        }
      : {};

  return new TronWeb({
    fullHost,
    headers,
    privateKey:
      TRON_PRIVATE_KEY
  });
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

    if (!process.env.DATABASE_URL) {

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


    if (!TRON_PRIVATE_KEY) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRON_PRIVATE_KEY não configurada."
        }
      );
    }


    if (!TRONGRID_API_KEY) {

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


    if (!PROCESS_SECRET) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "WITHDRAWAL_API_SECRET não configurado."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * AUTORIZAÇÃO INTERNA
     * -----------------------------------------------------
     */

    if (!verifyProcessSecret(req)) {

      return json(
        res,
        401,
        {
          success: false,
          error:
            "Não autorizado."
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
     * BUSCAR RETIRADA
     * -----------------------------------------------------
     *
     * Nunca usamos amount/address enviados pelo cliente.
     *
     * Os dados vêm da BD.
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


    if (withdrawals.length === 0) {

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
     * IDEMPOTÊNCIA
     * -----------------------------------------------------
     *
     * Se já terminou, não transmitimos novamente.
     * -----------------------------------------------------
     */

    if (
      withdrawal.status ===
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
     * Se já existe TX hash,
     * não criamos outra transação.
     */

    if (withdrawal.tx_hash) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Esta retirada já possui TX hash.",
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
     * STATUS
     * -----------------------------------------------------
     *
     * SOMENTE AUTHORIZED pode ser transmitido.
     * -----------------------------------------------------
     */

    if (
      withdrawal.status !==
      "AUTHORIZED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "A retirada ainda não está autorizada para transmissão.",
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
     * VALIDAR NETWORK
     * -----------------------------------------------------
     */

    if (
      String(
        withdrawal.network
      ) !== NETWORK
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Rede da retirada incompatível."
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
      ) !== ASSET
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Ativo da retirada incompatível."
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
            "Endereço de destino TRON inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALOR
     * -----------------------------------------------------
     */

    const rawAmount =
      databaseUsdtToRaw(
        withdrawal.amount
      );


    if (rawAmount <= 0n) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Valor da retirada inválido."
        }
      );
    }


    const amount =
      formatUsdtAmount(
        rawAmount
      );


    /*
     * -----------------------------------------------------
     * LOCALIZAR CARTEIRA PRINCIPAL
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


    if (wallets.length === 0) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "Carteira TRON Mainnet não configurada."
        }
      );
    }


    const wallet =
      wallets[0];


    const senderAddress =
      String(
        wallet.wallet_address ||
        ""
      ).trim();


    if (
      !isValidTronAddress(
        senderAddress
      )
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "Endereço da carteira principal inválido."
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
     * CONFIRMAR ACCOUNT ADDRESS
     * -----------------------------------------------------
     *
     * A private key deve corresponder à carteira
     * configurada na BD.
     * -----------------------------------------------------
     */

    const derivedAddress =
      tronWeb.address.fromPrivateKey(
        TRON_PRIVATE_KEY
      );


    if (
      !derivedAddress ||
      derivedAddress !==
        senderAddress
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "A TRON_PRIVATE_KEY não corresponde à carteira principal."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CONTRATO USDT
     * -----------------------------------------------------
     */

    const contract =
      await tronWeb
        .contract()
        .at(
          USDT_CONTRACT
        );


    /*
     * -----------------------------------------------------
     * SALDO USDT ON-CHAIN
     * -----------------------------------------------------
     */

    const onChainRaw =
      await contract
        .balanceOf(
          senderAddress
        )
        .call();


    const onChainBalance =
      BigInt(
        String(
          onChainRaw
        )
      );


    /*
     * -----------------------------------------------------
     * VERIFICAR USDT
     * -----------------------------------------------------
     */

    if (
      onChainBalance <
      rawAmount
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Saldo USDT on-chain insuficiente.",
          wallet: {
            address:
              senderAddress,
            balance:
              formatUsdtAmount(
                onChainBalance
              ),
            requested:
              amount
          }
        }
      );
    }


    /*
     * -----------------------------------------------------
     * SALDO TRX
     * -----------------------------------------------------
     */

    const trxBalance =
      await tronWeb.trx.getBalance(
        senderAddress
      );


    /*
     * Precisamos de TRX para energia/bandwidth/fees.
     *
     * Não tentamos enviar TRX automaticamente.
     */

    if (
      !Number.isSafeInteger(
        Number(trxBalance)
      )
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "Saldo TRX inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * MARCAR PROCESSING
     * -----------------------------------------------------
     *
     * Antes da transmissão.
     *
     * O banco fica sabendo que esta retirada
     * está sendo processada.
     * -----------------------------------------------------
     */

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

    `;


    /*
     * -----------------------------------------------------
     * CONSTRUIR TRANSFERÊNCIA TRC-20
     * -----------------------------------------------------
     */

    const transaction =
      await contract
        .transfer(
          destination,
          rawAmount.toString()
        )
        .send({
          feeLimit:
            FEE_LIMIT,
          shouldPollResponse:
            false
        });


    /*
     * -----------------------------------------------------
     * TX HASH
     * -----------------------------------------------------
     */

    const txHash =
      typeof transaction ===
        "string"
        ? transaction
        : transaction?.txid ||
          transaction?.transaction?.txID ||
          null;


    if (!txHash) {

      await sql`

        UPDATE withdrawals

        SET

          status =
            'FAILED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

      `;


      return json(
        res,
        502,
        {
          success: false,
          error:
            "A TRON não devolveu TX hash.",
          withdrawal_id:
            withdrawalId
        }
      );
    }


    /*
     * -----------------------------------------------------
     * GUARDAR TX HASH
     * -----------------------------------------------------
     */

    await sql`

      UPDATE withdrawals

      SET

        tx_hash =
          ${txHash},

        status =
          'COMPLETED',

        updated_at =
          NOW()

      WHERE withdrawal_id =
        ${withdrawalId}

        AND status =
          'PROCESSING'

    `;


    /*
     * -----------------------------------------------------
     * WALLET TRANSACTION
     * -----------------------------------------------------
     *
     * Registra a saída na contabilidade interna.
     *
     * Se a estrutura da tabela for diferente,
     * adaptamos esta parte às colunas reais.
     * -----------------------------------------------------
     */

    try {

      await sql`

        INSERT INTO wallet_transactions (

          wallet_address,
          asset,
          network,
          amount,
          type,
          tx_hash,
          created_at

        )

        VALUES (

          ${senderAddress},
          ${ASSET},
          ${NETWORK},
          ${amount},
          'WITHDRAWAL',
          ${txHash},
          NOW()

        )

      `;

    } catch (walletTransactionError) {

      /*
       * A transação blockchain já aconteceu.
       *
       * NÃO tentamos transmiti-la novamente.
       *
       * O erro é registrado para correção contábil.
       */

      console.error(
        "WALLET TRANSACTION RECORD ERROR:",
        walletTransactionError?.message ||
        walletTransactionError
      );

    }


    /*
     * -----------------------------------------------------
     * ATUALIZAR ORDER
     * -----------------------------------------------------
     */

    if (withdrawal.order_id) {

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

              ELSE
                'USDT_SENT'

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

    return json(
      res,
      200,
      {
        success: true,

        withdrawal: {

          withdrawal_id:
            withdrawalId,

          status:
            "COMPLETED",

          network:
            NETWORK,

          asset:
            ASSET,

          amount,

          destination_address:
            destination,

          tx_hash:
            txHash,

          broadcasted:
            true

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ TRON PROCESS ERROR:",
      error?.message ||
      error
    );


    /*
     * -----------------------------------------------------
     * ERRO
     * -----------------------------------------------------
     *
     * Atenção:
     *
     * Se o erro acontecer depois do broadcast,
     * não devemos tentar transmitir novamente
     * automaticamente sem verificar a blockchain.
     * -----------------------------------------------------
     */

    return json(
      res,
      500,
      {
        success: false,
        error:
          "Erro ao processar retirada TRON.",
        message:
          error?.message ||
          "Erro desconhecido."
      }
    );

  }

}
