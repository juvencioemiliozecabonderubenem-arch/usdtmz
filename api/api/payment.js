import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAYMENT API
 * POST /api/payment
 *
 * Fluxo:
 *
 * orders.PENDING
 *       ↓
 * Pagar API
 *       ↓
 * PROCESSING / PENDING
 *       ↓
 * webhook da Pagar
 *       ↓
 * PAYMENT_CONFIRMED
 *
 * IMPORTANTE:
 * - Nunca considerar HTTP 202 como pagamento confirmado.
 * - Nunca confiar no valor enviado pelo frontend.
 * - API Key e Signing Secret ficam somente no servidor.
 * =========================================================
 */

const API_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

const API_KEY =
  process.env.PAGAR_API_KEY;

const SIGNING_SECRET =
  process.env.PAGAR_SIGNING_SECRET;


/* =========================================================
   JSON
========================================================= */

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
   MÉTODO DE PAGAMENTO
========================================================= */

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
   ASSINATURA PAGAR
========================================================= */

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
   CHAMADA À PAGAR
========================================================= */

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
    await fetch(url, {

      method: "POST",

      headers: {

        Authorization:
          "Bearer " + API_KEY,

        "Content-Type":
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

      body: rawBody

    });

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

    error.code =
      data?.error || null;

    error.requestId =
      data?.requestId || null;

    error.httpStatus =
      response.status;

    throw error;
  }

  return data;
}


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  /* -------------------------------------------------------
     MÉTODO
  ------------------------------------------------------- */

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
       CONFIGURAÇÃO
    ----------------------------------------------------- */

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
       DATABASE
    ----------------------------------------------------- */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /* -----------------------------------------------------
       BODY
    ----------------------------------------------------- */

    const body =
      req.body || {};

    const orderId =
      String(
        body.order_id || ""
      ).trim();

    const requestedMethod =
      normalizeMethod(
        body.payment ||
        body.method
      );


    /* -----------------------------------------------------
       VALIDAR ORDER_ID
    ----------------------------------------------------- */

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
       VALIDAR PAGAMENTO
    ----------------------------------------------------- */

    if (!requestedMethod) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Método de pagamento inválido. Use MPESA ou EMOLA."
        }
      );
    }


    /* -----------------------------------------------------
       LOCALIZAR PEDIDO
    ----------------------------------------------------- */

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
          blockchain_tx_hash,
          wallet_address,
          updated_at,
          emola_transaction_id,
          pagar_payment_id

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
       ESTADO ATUAL
    ----------------------------------------------------- */

    const currentStatus =
      String(
        order.status || ""
      ).toUpperCase();


    /*
     * Pagamento já confirmado.
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
          order_id:
            order.order_id,
          status:
            currentStatus
        }
      );
    }


    /*
     * Pedido já concluído.
     */

    if (
      currentStatus ===
      "COMPLETED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido já foi concluído.",
          order_id:
            order.order_id,
          status:
            currentStatus
        }
      );
    }


    /*
     * Pedido já teve USDT enviado.
     */

    if (
      currentStatus ===
      "USDT_SENT"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "O USDT deste pedido já foi enviado.",
          order_id:
            order.order_id,
          status:
            currentStatus
        }
      );
    }


    /*
     * Cancelado ou falhado precisa de novo pedido.
     */

    if (
      currentStatus ===
      "CANCELLED" ||
      currentStatus ===
      "FAILED"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido não está disponível para novo pagamento.",
          order_id:
            order.order_id,
          status:
            currentStatus
        }
      );
    }


    /* -----------------------------------------------------
       VALOR
    ----------------------------------------------------- */

    const amount =
      Number(order.amount);


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
            "O valor deve ser um número inteiro entre 20 e 40.000 MZN."
        }
      );
    }


    /* -----------------------------------------------------
       TELEFONE
    ----------------------------------------------------- */

    const payerPhone =
      String(
        order.phone || ""
      ).trim();


    if (!payerPhone) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Número de telefone não encontrado no pedido."
        }
      );
    }


    /* -----------------------------------------------------
       GARANTIR QUE O MÉTODO DO PEDIDO É CONSISTENTE
    ----------------------------------------------------- */

    const existingPayment =
      normalizeMethod(
        order.payment
      );

    if (
      existingPayment &&
      existingPayment !==
      requestedMethod
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "O método de pagamento não corresponde ao pedido.",
          order_id:
            order.order_id,
          payment:
            existingPayment
        }
      );
    }


    /* -----------------------------------------------------
       REFERÊNCIA
    ----------------------------------------------------- */

    const reference =
      String(
        order.order_id
      );


    /* -----------------------------------------------------
       IDEMPOTÊNCIA
    ----------------------------------------------------- */

    const idempotencyKey =
      "payment:" +
      reference;


    /* -----------------------------------------------------
       SE JÁ TEMOS PAGAR PAYMENT ID
       NÃO CRIAR OUTRA COBRANÇA
    ----------------------------------------------------- */

    if (
      order.pagar_payment_id
    ) {

      return json(
        res,
        200,
        {
          success: true,
          message:
            "Pagamento já criado anteriormente.",
          payment: {
            id:
              order.pagar_payment_id
          },
          order: {
            order_id:
              order.order_id,
            status:
              order.status,
            amountMzn:
              amount,
            usdt_amount:
              order.usdt_amount,
            rate:
              order.rate
          }
        }
      );
    }


    /* -----------------------------------------------------
       CRIAR PAGAMENTO
    ----------------------------------------------------- */

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


    const payment =
      pagarResponse?.payment ||
      pagarResponse;


    /* -----------------------------------------------------
       VALIDAR RESPOSTA
    ----------------------------------------------------- */

    if (!payment?.id) {

      console.error(
        "PAGAR INVALID RESPONSE:",
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
       STATUS DA PAGAR
    ----------------------------------------------------- */

    const pagarStatus =
      String(
        payment.status || ""
      ).toUpperCase();


    /*
     * IMPORTANTE:
     *
     * Apenas PAID pode representar
     * pagamento confirmado.
     *
     * PROCESSING / PENDING continuam PENDING.
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
       TRANSACTION ID
    ----------------------------------------------------- */

    const providerTransactionId =
      payment.providerTransactionId ||
      null;


    /* -----------------------------------------------------
       GUARDAR PAGAMENTO
    ----------------------------------------------------- */

    await sql`

      UPDATE orders

      SET

        status =
          ${orderStatus},

        payment =
          ${requestedMethod},

        pagar_payment_id =
          ${String(
            payment.id
          )},

        updated_at =
          NOW()

      WHERE order_id =
        ${orderId}

    `;


    /* -----------------------------------------------------
       GUARDAR TRANSACTION ID
    ----------------------------------------------------- */

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
       RESPOSTA
    ----------------------------------------------------- */

    return json(
      res,
      orderStatus ===
      "PAYMENT_CONFIRMED"
        ? 200
        : 202,
      {

        success: true,

        payment: {

          id:
            payment.id,

          status:
            payment.status ||
            "PENDING",

          environment:
            payment.environment ||
            null,

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

          providerTransactionId,

          failureReason:
            payment.failureReason ||
            null,

          paidAt:
            payment.paidAt ||
            null

        },

        order: {

          order_id:
            order.order_id,

          status:
            orderStatus,

          amountMzn:
            amount,

          usdt_amount:
            order.usdt_amount,

          rate:
            order.rate

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
       CONFLITO
    ----------------------------------------------------- */

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
            error.code || null,
          requestId:
            error.requestId || null
        }
      );
    }


    /* -----------------------------------------------------
       AUTENTICAÇÃO
    ----------------------------------------------------- */

    if (
      error?.httpStatus ===
        401 ||
      error?.httpStatus ===
        403
    ) {

      return json(
        res,
        502,
        {
          success: false,
          error:
            "A Pagar recusou a autenticação da API.",
          requestId:
            error.requestId || null
        }
      );
    }


    /* -----------------------------------------------------
       RATE LIMIT
    ----------------------------------------------------- */

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
            "Limite temporário da API atingido.",
          requestId:
            error.requestId || null
        }
      );
    }


    /* -----------------------------------------------------
       ERRO GERAL
    ----------------------------------------------------- */

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
