// /api/payment.js
//
// USDTMZ — INICIAR PAGAMENTO PAGAR
// POST /api/payment
//
// IMPORTANTE:
// - As chaves ficam somente nas Environment Variables da Vercel.
// - Este endpoint NÃO confirma o pagamento.
// - A confirmação é feita pelo /api/pagar-webhook.js.

import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const sql = neon(process.env.DATABASE_URL);

const API_BASE_URL =
  process.env.PAGAR_API_BASE_URL || "https://api.pagar.co.mz/api/v1";

const API_KEY = process.env.PAGAR_API_KEY;
const SIGNING_SECRET = process.env.PAGAR_SIGNING_SECRET;

const MIN_AMOUNT_MZN = 20;
const MAX_AMOUNT_MZN = 40000;

function json(res, status, data) {
  res.status(status).json(data);
}

function safeBaseUrl() {
  try {
    const url = new URL(API_BASE_URL);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "URL_INVALIDA";
  }
}

function isValidPhone(phone) {
  return /^\d{9}$/.test(phone);
}

function isValidMethod(method) {
  return method === "MPESA" || method === "EMOLA";
}

function createPagarSignature({
  timestamp,
  nonce,
  method,
  canonicalPath,
  bodyHash,
}) {
  const canonical = [
    timestamp,
    nonce,
    method,
    canonicalPath,
    bodyHash,
  ].join("\n");

  return crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(canonical)
    .digest("hex");
}

async function pagarPost(path, body, idempotencyKey) {
  if (!API_KEY) {
    const error = new Error("PAGAR_API_KEY não configurada.");
    error.code = "MISSING_API_KEY";
    throw error;
  }

  if (!SIGNING_SECRET) {
    const error = new Error("PAGAR_SIGNING_SECRET não configurada.");
    error.code = "MISSING_SIGNING_SECRET";
    throw error;
  }

  let baseUrl;

  try {
    baseUrl = new URL(API_BASE_URL);
  } catch {
    const error = new Error("PAGAR_API_BASE_URL inválida.");
    error.code = "INVALID_BASE_URL";
    throw error;
  }

  const url = new URL(path, baseUrl);

  const timestamp = Date.now().toString();

  const nonce = crypto
    .randomBytes(18)
    .toString("base64url");

  const rawBody = JSON.stringify(body);

  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex");

  const canonicalPath = url.pathname;

  const signature = createPagarSignature({
    timestamp,
    nonce,
    method: "POST",
    canonicalPath,
    bodyHash,
  });

  console.log("USDTMZ PAGAR REQUEST:", {
    base: safeBaseUrl(),
    path: canonicalPath,
    method: "POST",
    environment:
      API_KEY.startsWith("sk_test_")
        ? "TEST"
        : API_KEY.startsWith("sk_live_")
        ? "LIVE"
        : "DESCONHECIDO",
  });

  const response = await fetch(url.toString(), {
    method: "POST",

    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",

      "Idempotency-Key": idempotencyKey,

      "X-Pagar-Timestamp": timestamp,
      "X-Pagar-Nonce": nonce,
      "X-Pagar-Signature": `v1=${signature}`,
    },

    body: rawBody,
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text.slice(0, 500),
    };
  }

  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("pagar-request-id") ||
    data?.requestId ||
    data?.request_id ||
    null;

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error ||
      `Pagar HTTP ${response.status}`
    );

    error.httpStatus = response.status;
    error.code =
      data?.code ||
      data?.errorCode ||
      data?.error_code ||
      "PAGAR_ERROR";

    error.requestId = requestId;

    console.error("USDTMZ PAGAR ERROR:", {
      httpStatus: error.httpStatus,
      code: error.code,
      requestId: error.requestId,
      message: error.message,
    });

    throw error;
  }

  console.log("USDTMZ PAGAR SUCCESS:", {
    httpStatus: response.status,
    requestId,
  });

  return {
    data,
    requestId,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido.",
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      return json(res, 500, {
        success: false,
        error: "DATABASE_URL não configurada.",
      });
    }

    if (!API_KEY || !SIGNING_SECRET) {
      return json(res, 500, {
        success: false,
        error: "Credenciais da Pagar não configuradas no servidor.",
      });
    }

    const { orderId } = req.body || {};

    if (!orderId) {
      return json(res, 400, {
        success: false,
        error: "orderId é obrigatório.",
      });
    }

    const rows = await sql`
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
        mpesa_transaction_id,
        emola_transaction_id
      FROM orders
      WHERE order_id = ${String(orderId)}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return json(res, 404, {
        success: false,
        error: "Pedido não encontrado.",
      });
    }

    const order = rows[0];

    // Se já existe pagamento Pagar, não criar outro.
    if (order.pagar_payment_id) {
      return json(res, 200, {
        success: true,
        alreadyCreated: true,
        payment: {
          id: order.pagar_payment_id,
          status: order.status,
        },
        order: {
          orderId: order.order_id,
          amountMzn: Number(order.amount),
          usdtAmount: Number(order.usdt_amount),
          method: order.payment,
        },
      });
    }

    // Não iniciar pagamento para pedidos já finalizados.
    if (
      order.status === "PAID" ||
      order.status === "COMPLETED" ||
      order.status === "CANCELLED" ||
      order.status === "FAILED"
    ) {
      return json(res, 409, {
        success: false,
        error: `O pedido está no estado ${order.status}.`,
      });
    }

    const amountMzn = Number(order.amount);

    if (
      !Number.isSafeInteger(amountMzn) ||
      amountMzn < MIN_AMOUNT_MZN ||
      amountMzn > MAX_AMOUNT_MZN
    ) {
      return json(res, 400, {
        success: false,
        error: `O valor deve estar entre ${MIN_AMOUNT_MZN} e ${MAX_AMOUNT_MZN} MZN.`,
      });
    }

    const phone = String(order.phone || "").trim();

    if (!isValidPhone(phone)) {
      return json(res, 400, {
        success: false,
        error: "Número de telefone inválido.",
      });
    }

    const method = String(order.payment || "")
      .trim()
      .toUpperCase();

    if (!isValidMethod(method)) {
      return json(res, 400, {
        success: false,
        error: "Método de pagamento inválido.",
      });
    }

    const reference = String(order.order_id);

    const body = {
      reference,
      title: "Compra USDTMZ",
      description: `Compra de ${order.usdt_amount} USDT`,
      amountMzn,
      method,
      payerPhone: phone,
    };

    const idempotencyKey = `payment:${reference}`;

    let result;

    try {
      result = await pagarPost(
        "/payments",
        body,
        idempotencyKey
      );
    } catch (error) {
      if (
        error.httpStatus === 401 ||
        error.httpStatus === 403
      ) {
        return json(res, 502, {
          success: false,
          error: "A Pagar recusou a autenticação da API.",
          code: error.code || "AUTH_ERROR",
          requestId: error.requestId || null,
        });
      }

      if (error.httpStatus === 409) {
        return json(res, 409, {
          success: false,
          error: "A Pagar informou um conflito para este pagamento.",
          code: error.code || "CONFLICT",
          requestId: error.requestId || null,
        });
      }

      if (error.httpStatus === 429) {
        return json(res, 429, {
          success: false,
          error: "A Pagar limitou temporariamente os pedidos.",
          requestId: error.requestId || null,
        });
      }

      console.error("USDTMZ PAYMENT ERROR:", {
        code: error.code,
        httpStatus: error.httpStatus,
        requestId: error.requestId,
        message: error.message,
      });

      return json(res, 502, {
        success: false,
        error: "Não foi possível iniciar o pagamento na Pagar.",
        code: error.code || "PAGAR_ERROR",
        requestId: error.requestId || null,
      });
    }

    const data = result.data || {};

    const pagarPaymentId =
      data.id ||
      data.paymentId ||
      data.payment_id ||
      null;

    const providerTransactionId =
      data.transactionId ||
      data.transaction_id ||
      null;

    if (!pagarPaymentId) {
      console.error(
        "USDTMZ PAGAR: resposta sem payment ID"
      );

      return json(res, 502, {
        success: false,
        error: "A Pagar não devolveu o ID do pagamento.",
        requestId: result.requestId || null,
      });
    }

    await sql`
      UPDATE orders
      SET
        pagar_payment_id = ${String(pagarPaymentId)},
        mpesa_transaction_id =
          CASE
            WHEN ${method} = 'MPESA'
            THEN COALESCE(
              ${providerTransactionId},
              mpesa_transaction_id
            )
            ELSE mpesa_transaction_id
          END,
        emola_transaction_id =
          CASE
            WHEN ${method} = 'EMOLA'
            THEN COALESCE(
              ${providerTransactionId},
              emola_transaction_id
            )
            ELSE emola_transaction_id
          END,
        updated_at = NOW()
      WHERE order_id = ${reference}
    `;

    return json(res, 202, {
      success: true,
      message: "Pagamento iniciado. Aguarde a confirmação.",
      payment: {
        id: String(pagarPaymentId),
        status:
          data.status ||
          data.paymentStatus ||
          "PENDING",
      },
      order: {
        orderId: reference,
        amountMzn,
        usdtAmount: Number(order.usdt_amount),
        method,
      },
      requestId: result.requestId || null,
    });

  } catch (error) {
    console.error("USDTMZ PAYMENT INTERNAL ERROR:", {
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus,
      requestId: error.requestId,
    });

    return json(res, 500, {
      success: false,
      error: "Erro interno ao iniciar o pagamento.",
    });
  }
}
