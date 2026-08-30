import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const API_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

/* =========================================================
   JSON
========================================================= */

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* =========================================================
   PAGAR POST
========================================================= */

async function pagarPost(path, body, idempotencyKey) {
  const apiKey = process.env.PAGAR_API_KEY;
  const signingSecret =
    process.env.PAGAR_SIGNING_SECRET;

  if (!apiKey) {
    throw new Error("PAGAR_API_KEY não configurada.");
  }

  if (!signingSecret) {
    throw new Error(
      "PAGAR_SIGNING_SECRET não configurado."
    );
  }

  const timestamp = Date.now().toString();

  const nonce =
    crypto.randomBytes(18).toString("base64url");

  const rawBody = JSON.stringify(body);

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const url = API_URL + path;

  const canonicalPath =
    new URL(url).pathname;

  const canonical = [
    timestamp,
    nonce,
    "POST",
    canonicalPath,
    bodyHash
  ].join("\n");

  const signature =
    crypto
      .createHmac(
        "sha256",
        signingSecret
      )
      .update(canonical)
      .digest("hex");

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization:
        "Bearer " + apiKey,

      "Content-Type":
        "application/json",

      "Idempotency-Key":
        idempotencyKey,

      "X-Pagar-Timestamp":
        timestamp,

      "X-Pagar-Nonce":
        nonce,

      "X-Pagar-Signature":
        "v1=" + signature
    },

    body: rawBody
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
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

export default async function handler(req, res) {

  /* -------------------------------------------------------
     MÉTODO
  ------------------------------------------------------- */

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    /* -----------------------------------------------------
       DATABASE
    ----------------------------------------------------- */

    if (!process.env.DATABASE_URL) {
      return json(res, 500, {
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);

    /* -----------------------------------------------------
       BODY
    ----------------------------------------------------- */

    const body = req.body || {};

    /*
     * Aceitamos order_id porque é o nome
     * utilizado pelo frontend USDTMZ.
     */

    const orderId =
      String(
        body.order_id ||
        body.orderId ||
        ""
      ).trim();

    if (!orderId) {
      return json(res, 400, {
        success: false,
        error: "order_id é obrigatório."
      });
    }

    /* -----------------------------------------------------
       LOCALIZAR PEDIDO
    ----------------------------------------------------- */

    const orders = await sql`
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
        pagar_payment_id,
        created_at,
        updated_at
      FROM orders
      WHERE order_id = ${orderId}
      LIMIT 1
    `;

    if (orders.length === 0) {
      return json(res, 404, {
        success: false,
        error: "Pedido não encontrado."
      });
    }

    const order = orders[0];

    /* -----------------------------------------------------
       ESTADO
    ----------------------------------------------------- */

    const currentStatus =
      String(
        order.status || ""
      ).toUpperCase();

    /*
     * Se já existe pagamento da Pagar,
     * não criar outro.
     */

    if (order.pagar_payment_id) {

      return json(res, 200, {
        success: true,

        existing: true,

        payment: {
          id:
            String(
              order.pagar_payment_id
            ),

          status:
            currentStatus
        },

        order: {
          order_id:
            order.order_id,

          status:
            currentStatus,

          amountMzn:
            Number(order.amount),

          usdt_amount:
            order.usdt_amount,

          rate:
            order.rate
        }
      });
    }

    /*
     * Nunca criar novo pagamento para estados
     * que já representam uma operação finalizada.
     */

    if (
      [
        "PAYMENT_CONFIRMED",
        "PAID",
        "USDT_SENT",
        "COMPLETED"
      ].includes(currentStatus)
    ) {

      return json(res, 409, {
        success: false,
        error:
          "Este pedido já possui um estado final.",
        status:
          currentStatus
      });
    }

    /*
     * PROCESSING sem payment ID também não
     * deve gerar cobrança automaticamente.
     */

    if (currentStatus === "PROCESSING") {
      return json(res, 409, {
        success: false,
        error:
          "Este pedido já está em processamento.",
        status:
          currentStatus
      });
    }

    /* -----------------------------------------------------
       VALOR
    ----------------------------------------------------- */

    const amountMzn =
      Number(order.amount);

    if (
      !Number.isSafeInteger(amountMzn) ||
      amountMzn < 20 ||
      amountMzn > 40000
    ) {

      return json(res, 400, {
        success: false,
        error:
          "O valor deve ser um número inteiro entre 20 e 40.000 MZN."
      });
    }

    /* -----------------------------------------------------
       MÉTODO
    ----------------------------------------------------- */

    const method =
      String(
        order.payment || ""
      )
        .trim()
        .toUpperCase();

    if (
      method !== "MPESA" &&
      method !== "EMOLA"
    ) {

      return json(res, 400, {
        success: false,
        error:
          "Método de pagamento inválido."
      });
    }

    /* -----------------------------------------------------
       TELEFONE
    ----------------------------------------------------- */

    const payerPhone =
      String(
        order.phone || ""
      ).trim();

    if (
      !/^\d{9}$/.test(
        payerPhone
      )
    ) {

      return json(res, 400, {
        success: false,
        error:
          "Número de telefone inválido."
      });
    }

    /* -----------------------------------------------------
       REFERENCE
    ----------------------------------------------------- */

    const reference =
      String(
        order.order_id
      );

    /* -----------------------------------------------------
       PAGAR PAYMENT
    ----------------------------------------------------- */

    const paymentBody = {

      reference,

      title:
        "Compra USDTMZ",

      description:
        `Compra de ${order.usdt_amount} USDT`,

      amountMzn,

      method,

      payerPhone
    };

    /*
     * A documentação da Pagar recomenda usar
     * a mesma Idempotency-Key para retries da
     * mesma operação.
     */

    const idempotencyKey =
      "payment:" + reference;

    const result =
      await pagarPost(
        "/payments",
        paymentBody,
        idempotencyKey
      );

    const payment =
      result?.payment || result;

    /* -----------------------------------------------------
       VALIDAR PAYMENT ID
    ----------------------------------------------------- */

    if (!payment?.id) {

      console.error(
        "PAGAR INVALID RESPONSE:",
        result
      );

      return json(res, 502, {
        success: false,
        error:
          "A Pagar não devolveu um ID de pagamento válido."
      });
    }

    /* -----------------------------------------------------
       STATUS
    ----------------------------------------------------- */

    const pagarStatus =
      String(
        payment.status ||
        "PROCESSING"
      ).toUpperCase();

    /*
     * IMPORTANTE:
     *
     * Mesmo que a Pagar devolva PAID,
     * a confirmação final do pedido será
     * feita pelo webhook.
     */

    let orderStatus =
      "PROCESSING";

    if (
      pagarStatus === "PENDING"
    ) {
      orderStatus = "PENDING";
    }

    if (
      pagarStatus === "PROCESSING"
    ) {
      orderStatus = "PROCESSING";
    }

    /*
     * Não usamos PAYMENT_CONFIRMED aqui.
     *
     * O webhook é responsável pela confirmação.
     */

    /* -----------------------------------------------------
       GUARDAR PAGAMENTO
    ----------------------------------------------------- */

    await sql`
      UPDATE orders
      SET

        status =
          ${orderStatus},

        pagar_payment_id =
          ${String(payment.id)},

        updated_at =
          NOW()

      WHERE id =
        ${order.id}

      AND pagar_payment_id IS NULL
    `;

    /* -----------------------------------------------------
       TRANSACTION ID
    ----------------------------------------------------- */

    const providerTransactionId =
      payment.providerTransactionId ||
      null;

    if (providerTransactionId) {

      if (method === "MPESA") {

        await sql`
          UPDATE orders
          SET
            mpesa_transaction_id =
              ${String(
                providerTransactionId
              )},

            updated_at =
              NOW()

          WHERE id =
            ${order.id}
        `;
      }

      if (method === "EMOLA") {

        await sql`
          UPDATE orders
          SET
            emola_transaction_id =
              ${String(
                providerTransactionId
              )},

            updated_at =
              NOW()

          WHERE id =
            ${order.id}
        `;
      }
    }

    /* -----------------------------------------------------
       RESPOSTA
    ----------------------------------------------------- */

    return json(res, 202, {

      success: true,

      payment: {

        id:
          String(payment.id),

        status:
          pagarStatus,

        amountMzn:
          payment.amountMzn ||
          amountMzn,

        currency:
          payment.currency ||
          "MZN",

        method:
          payment.method ||
          method,

        environment:
          payment.environment ||
          null,

        purpose:
          payment.purpose ||
          "PAYMENT",

        reference:
          payment.reference ||
          reference,

        title:
          payment.title ||
          "Compra USDTMZ",

        description:
          payment.description ||
          `Compra de ${order.usdt_amount} USDT`,

        payerPhone:
          payment.payerPhone ||
          null,

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
          amountMzn,

        usdt_amount:
          order.usdt_amount,

        rate:
          order.rate

      }

    });

  } catch (error) {

    console.error(
      "USDTMZ PAGAR PAYMENT ERROR:",
      error?.message ||
      error
    );

    if (
      error?.httpStatus === 409
    ) {

      return json(res, 409, {
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
      });
    }

    if (
      error?.httpStatus === 401 ||
      error?.httpStatus === 403
    ) {

      return json(res, 502, {
        success: false,
        error:
          "A Pagar recusou a autenticação da API.",
        requestId:
          error.requestId ||
          null
      });
    }

    if (
      error?.httpStatus === 429
    ) {

      return json(res, 429, {
        success: false,
        error:
          "Limite temporário da Pagar atingido.",
        requestId:
          error.requestId ||
          null
      });
    }

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao iniciar o pagamento.",
      requestId:
        error?.requestId ||
        null
    });
  }
}
