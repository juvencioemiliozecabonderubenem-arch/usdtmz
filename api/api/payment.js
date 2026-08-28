import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR PAYMENT API — BLOCO 3B
 * =========================================================
 *
 * POST /api/payment
 *
 * Cria uma cobrança M-Pesa/e-Mola na Pagar.
 *
 * FLUXO:
 *
 * orders.PENDING
 *       ↓
 * Pagar /payments
 *       ↓
 * PROCESSING / PENDING
 *       ↓
 * webhook
 *       ↓
 * PAYMENT_CONFIRMED
 *
 * IMPORTANTE:
 * - Nunca marcamos PAYMENT_CONFIRMED apenas porque a Pagar
 *   respondeu HTTP 202.
 * - O USDT NÃO é enviado neste endpoint.
 * - O saldo da carteira NÃO é alterado neste endpoint.
 * - A confirmação definitiva será feita pelo webhook.
 */

const API_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

const API_KEY =
  process.env.PAGAR_API_KEY;

const SIGNING_SECRET =
  process.env.PAGAR_SIGNING_SECRET;


/* =========================================================
 * JSON
 * ========================================================= */

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(status)
    .json(data);
}


/* =========================================================
 * MÉTODO DE PAGAMENTO
 * ========================================================= */

function normalizeMethod(value) {

  const method =
    String(value || "")
      .trim()
      .toUpperCase();

  if (method === "MPESA") {
    return "MPESA";
  }

  if (method === "EMOLA") {
    return "EMOLA";
  }

  return null;
}


/* =========================================================
 * TELEFONE
 * ========================================================= */

function normalizePhone(value) {

  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}


/* =========================================================
 * ASSINATURA PAGAR
 * ========================================================= */

function createSignature(
  method,
  pathname,
  rawBody
) {

  const timestamp =
    Date.now().toString();

  const nonce =
    crypto
      .randomBytes(18)
      .toString("base64url");

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const canonical = [
    timestamp,
    nonce,
    method,
    pathname,
    bodyHash
  ].join("\n");

  const signature =
    crypto
      .createHmac(
        "sha256",
        SIGNING_SECRET
      )
      .update(canonical)
      .digest("hex");

  return {
    timestamp,
    nonce,
    signature:
      "v1=" + signature
  };
}


/* =========================================================
 * PAGAR POST
 * ========================================================= */

async function pagarPost(
  pathname,
  body,
  idempotencyKey
) {

  if (!API_KEY) {
    throw new Error(
      "PAGAR_API_KEY não configurada."
    );
  }

  if (!SIGNING_SECRET) {
    throw new Error(
      "PAGAR_SIGNING_SECRET não configurado."
    );
  }

  const rawBody =
    JSON.stringify(body);

  const url =
    API_URL + pathname;

  const canonicalPath =
    new URL(url).pathname;

  const auth =
    createSignature(
      "POST",
      canonicalPath,
      rawBody
    );

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " + API_KEY,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          "Idempotency-Key":
            idempotencyKey,

          "X-Pagar-Timestamp":
            auth.timestamp,

          "X-Pagar-Nonce":
            auth.nonce,

          "X-Pagar-Signature":
            auth.signature
        },

        body:
          rawBody
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {

    const error =
      new Error(
        data?.message ||
        data?.error ||
        "Pedido rejeitado pela Pagar API."
      );

    error.httpStatus =
      response.status;

    error.code =
      data?.error ||
      null;

    error.requestId =
      data?.requestId ||
      null;

    throw error;
  }

  return data;
}


/* =========================================================
 * HANDLER
 * ========================================================= */

export default async function handler(
  req,
  res
) {

  /* -------------------------------------------------------
   * MÉTODO
   * ------------------------------------------------------- */

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

    /* -----------------------------------------------------
     * CONFIGURAÇÃO
     * ----------------------------------------------------- */

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

    if (!API_KEY) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "PAGAR_API_KEY não configurada."
        }
      );
    }

    if (!SIGNING_SECRET) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "PAGAR_SIGNING_SECRET não configurado."
        }
      );
    }


    /* -----------------------------------------------------
     * DATABASE
     * ----------------------------------------------------- */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /* -----------------------------------------------------
     * BODY
     * ----------------------------------------------------- */

    const body =
      req.body || {};


    const orderId =
      String(
        body.order_id ||
        ""
      ).trim();


    const requestedMethod =
      normalizeMethod(
        body.payment ||
        body.method
      );


    const requestedPhone =
      normalizePhone(
        body.phone
      );


    /* -----------------------------------------------------
     * VALIDAR ORDER
     * ----------------------------------------------------- */

    if (!orderId) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "order_id é obrigatório."
        }
      );
    }


    /* -----------------------------------------------------
     * VALIDAR MÉTODO
     * ----------------------------------------------------- */

    if (!requestedMethod) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Método inválido. Use MPESA ou EMOLA."
        }
      );
    }


    /* -----------------------------------------------------
     * LOCALIZAR ORDER
     * ----------------------------------------------------- */

    const orders =
      await sql`

        SELECT

          id,
          order_id,
          name,
          phone,
          operation,
          payment,
          amount,
          usdt_amount,
          rate,
          status,

          created_at,

          mpesa_transaction_id,
          emola_transaction_id,

          pagar_payment_id,

          blockchain_tx_hash,
          wallet_address,

          updated_at

        FROM orders

        WHERE order_id =
          ${orderId}

        LIMIT 1

      `;


    if (orders.length === 0) {

      return json(
        res,
        404,
        {
          success: false,
          error:
            "Pedido não encontrado."
        }
      );
    }


    const order =
      orders[0];


    /* -----------------------------------------------------
     * STATUS
     * ----------------------------------------------------- */

    const currentStatus =
      String(
        order.status || ""
      )
        .trim()
        .toUpperCase();


    /*
     * Pedido já confirmado.
     */

    if (
      currentStatus ===
      "PAYMENT_CONFIRMED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido já possui pagamento confirmado.",

          order: {
            order_id:
              order.order_id,

            status:
              currentStatus,

            pagar_payment_id:
              order.pagar_payment_id ||
              null
          }
        }
      );
    }


    /*
     * Pedido já concluído.
     */

    if (
      currentStatus ===
        "USDT_SENT" ||
      currentStatus ===
        "COMPLETED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido já foi processado.",

          order: {
            order_id:
              order.order_id,

            status:
              currentStatus
          }
        }
      );
    }


    /*
     * Pedido falhado/cancelado não deve
     * ser reutilizado automaticamente.
     */

    if (
      currentStatus ===
        "FAILED" ||
      currentStatus ===
        "CANCELLED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido não pode receber uma nova cobrança.",

          order: {
            order_id:
              order.order_id,

            status:
              currentStatus
          }
        }
      );
    }


    /* -----------------------------------------------------
     * VALOR DA BASE DE DADOS
     * ----------------------------------------------------- */

    const amount =
      Number(
        order.amount
      );


    if (
      !Number.isSafeInteger(amount) ||
      amount < 20 ||
      amount > 40000
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "O valor do pedido deve ser um número inteiro entre 20 e 40.000 MZN."
        }
      );
    }


    /* -----------------------------------------------------
     * TELEFONE
     * ----------------------------------------------------- */

    const payerPhone =
      requestedPhone ||
      normalizePhone(
        order.phone
      );


    if (!payerPhone) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Número de telefone não encontrado."
        }
      );
    }


    /* -----------------------------------------------------
     * REFERENCE
     * ----------------------------------------------------- */

    const reference =
      String(
        order.order_id
      );


    /* -----------------------------------------------------
     * IDEMPOTÊNCIA
     * -----------------------------------------------------
     *
     * O mesmo order_id representa a mesma cobrança.
     *
     * Isso reduz o risco de criar cobranças
     * duplicadas em caso de retry.
     */

    const idempotencyKey =
      "payment:" +
      reference;


    /* -----------------------------------------------------
     * ATUALIZAR MÉTODO
     * ----------------------------------------------------- */

    await sql`

      UPDATE orders

      SET

        payment =
          ${requestedMethod},

        updated_at =
          NOW()

      WHERE order_id =
        ${orderId}

    `;


    /* -----------------------------------------------------
     * CRIAR PAGAMENTO
     * ----------------------------------------------------- */

    const pagarResponse =
      await pagarPost(

        "/payments",

        {
          reference,

          title:
            "USDTMZ",

          description:
            `Pedido ${reference} — ${amount} MZN`,

          amountMzn:
            amount,

          method:
            requestedMethod,

          payerPhone

        },

        idempotencyKey
      );


    /* -----------------------------------------------------
     * NORMALIZAR RESPOSTA
     * ----------------------------------------------------- */

    const payment =
      pagarResponse?.payment ||
      pagarResponse;


    if (!payment?.id) {

      console.error(
        "USDTMZ PAGAR INVALID RESPONSE:",
        pagarResponse
      );

      return json(
        res,
        502,
        {
          success: false,
          error:
            "A Pagar não devolveu um ID de pagamento válido."
        }
      );
    }


    /* -----------------------------------------------------
     * PAYMENT ID
     * ----------------------------------------------------- */

    const pagarPaymentId =
      String(
        payment.id
      );


    /* -----------------------------------------------------
     * STATUS PAGAR
     * ----------------------------------------------------- */

    const pagarStatus =
      String(
        payment.status ||
        ""
      )
        .trim()
        .toUpperCase();


    /*
     * NUNCA transformar PROCESSING/PENDING
     * em PAYMENT_CONFIRMED.
     *
     * Apenas PAID é confirmação imediata,
     * caso a própria API devolva esse estado.
     *
     * Mesmo assim, o webhook continuará sendo
     * a fonte definitiva.
     */

    let orderStatus =
      "PENDING";


    if (
      pagarStatus ===
      "PAID"
    ) {

      orderStatus =
        "PAYMENT_CONFIRMED";
    }


    /* -----------------------------------------------------
     * TRANSACTION ID DO PROVIDER
     * ----------------------------------------------------- */

    const providerTransactionId =
      payment.providerTransactionId ||
      null;


    /* -----------------------------------------------------
     * ATUALIZAR ORDER
     * ----------------------------------------------------- */

    await sql`

      UPDATE orders

      SET

        pagar_payment_id =
          ${pagarPaymentId},

        status =
          ${orderStatus},

        payment =
          ${requestedMethod},

        updated_at =
          NOW()

      WHERE order_id =
        ${orderId}

    `;


    /* -----------------------------------------------------
     * GUARDAR TRANSACTION ID
     * ----------------------------------------------------- */

    if (
      providerTransactionId &&
      requestedMethod ===
        "MPESA"
    ) {

      await sql`

        UPDATE orders

        SET

          mpesa_transaction_id =
            ${String(
              providerTransactionId
            )},

          updated_at =
            NOW()

        WHERE order_id =
          ${orderId}

      `;
    }


    if (
      providerTransactionId &&
      requestedMethod ===
        "EMOLA"
    ) {

      await sql`

        UPDATE orders

        SET

          emola_transaction_id =
            ${String(
              providerTransactionId
            )},

          updated_at =
            NOW()

        WHERE order_id =
          ${orderId}

      `;
    }


    /* -----------------------------------------------------
     * RESPOSTA
     * ----------------------------------------------------- */

    return json(
      res,
      202,
      {

        success:
          true,

        message:
          orderStatus ===
          "PAYMENT_CONFIRMED"

            ? "Pagamento confirmado pela Pagar."

            : "Pagamento criado e aguardando confirmação.",

        payment: {

          id:
            pagarPaymentId,

          status:
            payment.status ||
            "PROCESSING",

          reference:
            payment.reference ||
            reference,

          amountMzn:
            payment.amountMzn ||
            amount,

          currency:
            payment.currency ||
            "MZN",

          method:
            payment.method ||
            requestedMethod,

          payerPhone:
            payment.payerPhone ||
            payerPhone,

          providerTransactionId:
            providerTransactionId,

          paidAt:
            payment.paidAt ||
            null,

          failureReason:
            payment.failureReason ||
            null
        },

        order: {

          order_id:
            orderId,

          status:
            orderStatus,

          amountMzn:
            amount,

          usdt_amount:
            order.usdt_amount,

          rate:
            order.rate,

          pagar_payment_id:
            pagarPaymentId,

          usdtReleased:
            false,

          blockchainBroadcasted:
            false
        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ PAGAR PAYMENT ERROR:",
      error?.message ||
      error
    );


    /* -----------------------------------------------------
     * CONFLITO
     * ----------------------------------------------------- */

    if (
      error?.httpStatus ===
      409
    ) {

      return json(
        res,
        409,
        {
          success: false,

          error:
            error.message ||
            "Conflito ao criar o pagamento.",

          code:
            error.code ||
            null,

          requestId:
            error.requestId ||
            null
        }
      );
    }


    /* -----------------------------------------------------
     * AUTH
     * ----------------------------------------------------- */

    if (
      error?.httpStatus === 401 ||
      error?.httpStatus === 403
    ) {

      return json(
        res,
        502,
        {
          success: false,

          error:
            "A Pagar recusou a autenticação da API.",

          requestId:
            error.requestId ||
            null
        }
      );
    }


    /* -----------------------------------------------------
     * RATE LIMIT
     * ----------------------------------------------------- */

    if (
      error?.httpStatus ===
      429
    ) {

      return json(
        res,
        429,
        {
          success: false,

          error:
            "Limite temporário da API atingido. Tente novamente mais tarde.",

          requestId:
            error.requestId ||
            null
        }
      );
    }


    /* -----------------------------------------------------
     * ERRO
     * ----------------------------------------------------- */

    return json(
      res,
      500,
      {
        success: false,

        error:
          "Erro interno ao criar o pagamento.",

        requestId:
          error?.requestId ||
          null
      }
    );
  }
}
