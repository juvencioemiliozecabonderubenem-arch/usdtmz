import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const API_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

function json(res, status, data) {
  return res.status(status).json(data);
}

async function pagarPost(path, body, idempotencyKey) {
  const apiKey = process.env.PAGAR_API_KEY;
  const signingSecret =
    process.env.PAGAR_SIGNING_SECRET;

  if (!apiKey || !signingSecret) {
    throw new Error(
      "Credenciais Pagar não configuradas."
    );
  }

  const timestamp =
    Date.now().toString();

  const nonce =
    crypto.randomBytes(18).toString("base64url");

  const rawBody =
    JSON.stringify(body);

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const url =
    API_URL + path;

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

  const response =
    await fetch(url, {
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

  const data =
    await response.json();

  if (!response.ok) {
    const error =
      new Error(
        data.message ||
        "Pedido rejeitado pela Pagar."
      );

    error.code =
      data.error;

    error.requestId =
      data.requestId;

    throw error;
  }

  return data;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error:
        "Método não permitido."
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      return json(res, 500, {
        success: false,
        error:
          "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);

    const body =
      req.body || {};

    const orderId =
      String(
        body.orderId || ""
      ).trim();

    if (!orderId) {
      return json(res, 400, {
        success: false,
        error:
          "orderId é obrigatório."
      });
    }

    /*
     * =========================
     * BUSCAR ORDEM
     * =========================
     */

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
          status
        FROM orders
        WHERE order_id = ${orderId}
        LIMIT 1
      `;

    if (orders.length === 0) {
      return json(res, 404, {
        success: false,
        error:
          "Ordem não encontrada."
      });
    }

    const order =
      orders[0];

    /*
     * =========================
     * EVITAR COBRANÇA DUPLICADA
     * =========================
     */

    const currentStatus =
      String(
        order.status || ""
      ).toUpperCase();

    if (
      currentStatus === "PAID" ||
      currentStatus === "PROCESSING"
    ) {
      return json(res, 409, {
        success: false,
        error:
          "Esta ordem já está em processamento ou foi paga.",
        status:
          currentStatus
      });
    }

    /*
     * =========================
     * VALIDAR VALOR
     * =========================
     */

    const amountMzn =
      Number(order.amount);

    if (
      !Number.isSafeInteger(
        amountMzn
      ) ||
      amountMzn < 20 ||
      amountMzn > 40000
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Valor da ordem inválido para pagamento."
      });
    }

    /*
     * =========================
     * MÉTODO
     * =========================
     */

    const method =
      String(
        order.payment || ""
      ).trim().toUpperCase();

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

    /*
     * =========================
     * TELEFONE
     * =========================
     */

    const payerPhone =
      String(
        order.phone || ""
      ).trim();

    if (!/^\d{9}$/.test(payerPhone)) {
      return json(res, 400, {
        success: false,
        error:
          "Número de telefone inválido."
      });
    }

    /*
     * =========================
     * CRIAR PAGAMENTO
     * =========================
     */

    const reference =
      String(
        order.order_id
      );

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

    const result =
      await pagarPost(
        "/payments",
        paymentBody,
        "payment:" + reference
      );

    const payment =
      result.payment;

    /*
     * =========================
     * ATUALIZAR ORDEM
     * =========================
     */

    await sql`
      UPDATE orders
      SET
        status = ${String(
          payment.status ||
          "PROCESSING"
        ).toUpperCase()},
        updated_at = NOW()
      WHERE order_id = ${orderId}
    `;

    return json(res, 202, {
      success: true,

      payment: {
        id:
          payment.id,

        status:
          payment.status,

        amountMzn:
          payment.amountMzn,

        currency:
          payment.currency,

        method:
          payment.method,

        reference:
          payment.reference,

        environment:
          payment.environment
      }
    });

  } catch (error) {

    console.error(
      "PAGAR PAYMENT ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {
      success: false,
      error:
        "Não foi possível iniciar o pagamento."
    });
  }
}
