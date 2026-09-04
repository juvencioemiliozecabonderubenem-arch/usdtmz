// /api/payment.js
//
// USDTMZ — INICIAR PAGAMENTO
//
// MODO SIMULAÇÃO:
//   pedido -> pagamento simulado
//
// MODO NORMAL:
//   pedido -> Pagar
//
// IMPORTANTE:
// - A simulação não chama a Pagar.
// - A simulação não movimenta dinheiro.
// - A simulação não movimenta blockchain.
// - Credenciais ficam somente nas Environment Variables.
//

import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const API_BASE_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

const API_KEY =
  process.env.PAGAR_API_KEY;

const SIGNING_SECRET =
  process.env.PAGAR_SIGNING_SECRET;

const MIN_AMOUNT_MZN = 20;
const MAX_AMOUNT_MZN = 40000;

/* =========================================================
   DATABASE
========================================================= */

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL não configurada."
    );
  }

  return neon(
    process.env.DATABASE_URL
  );
}

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
   SIMULAÇÃO
========================================================= */

function isSimulationMode() {
  return (
    String(
      process.env.USDTMZ_SIMULATION_MODE || ""
    )
      .trim()
      .toLowerCase() === "true"
  );
}

/* =========================================================
   VALIDAÇÕES
========================================================= */

function isValidPhone(phone) {
  return /^\d{9}$/.test(phone);
}

function isValidMethod(method) {
  return (
    method === "MPESA" ||
    method === "EMOLA"
  );
}

/* =========================================================
   URL PAGAR
========================================================= */

function safeBaseUrl() {
  try {
    const url = new URL(
      API_BASE_URL
    );

    return `${url.origin}${url.pathname}`
      .replace(/\/+$/, "");

  } catch {
    return "URL_INVALIDA";
  }
}

/* =========================================================
   ASSINATURA PAGAR
========================================================= */

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
    .createHmac(
      "sha256",
      SIGNING_SECRET
    )
    .update(canonical)
    .digest("hex");
}

/* =========================================================
   POST PAGAR
========================================================= */

async function pagarPost(
  path,
  body,
  idempotencyKey
) {
  if (!API_KEY) {
    const error = new Error(
      "PAGAR_API_KEY não configurada."
    );

    error.code =
      "MISSING_API_KEY";

    throw error;
  }

  if (!SIGNING_SECRET) {
    const error = new Error(
      "PAGAR_SIGNING_SECRET não configurada."
    );

    error.code =
      "MISSING_SIGNING_SECRET";

    throw error;
  }

  const baseUrl =
    safeBaseUrl();

  if (
    baseUrl === "URL_INVALIDA"
  ) {
    const error = new Error(
      "PAGAR_API_BASE_URL inválida."
    );

    error.code =
      "INVALID_BASE_URL";

    throw error;
  }

  const urlString =
    `${baseUrl}${path}`;

  let url;

  try {
    url = new URL(
      urlString
    );
  } catch {
    const error = new Error(
      "URL final da Pagar inválida."
    );

    error.code =
      "INVALID_PAGAR_URL";

    throw error;
  }

  const timestamp =
    Date.now().toString();

  const nonce =
    crypto
      .randomBytes(18)
      .toString("base64url");

  const rawBody =
    JSON.stringify(body);

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const canonicalPath =
    url.pathname;

  const signature =
    createPagarSignature({
      timestamp,
      nonce,
      method: "POST",
      canonicalPath,
      bodyHash,
    });

  const environment =
    API_KEY.startsWith("sk_test_")
      ? "TEST"
      : API_KEY.startsWith("sk_live_")
      ? "LIVE"
      : "DESCONHECIDO";

  console.log(
    "USDTMZ PAGAR REQUEST:",
    {
      base: baseUrl,
      path: canonicalPath,
      method: "POST",
      environment,
    }
  );

  const response =
    await fetch(
      url.toString(),
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${API_KEY}`,

          "Content-Type":
            "application/json",

          "Idempotency-Key":
            idempotencyKey,

          "X-Pagar-Timestamp":
            timestamp,

          "X-Pagar-Nonce":
            nonce,

          "X-Pagar-Signature":
            `v1=${signature}`,
        },

        body: rawBody,
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    data = {
      raw:
        text.slice(0, 500),
    };
  }

  const requestId =
    response.headers.get(
      "x-request-id"
    ) ||
    response.headers.get(
      "pagar-request-id"
    ) ||
    data?.requestId ||
    data?.request_id ||
    null;

  if (!response.ok) {
    const error =
      new Error(
        data?.message ||
        data?.error ||
        `Pagar HTTP ${response.status}`
      );

    error.httpStatus =
      response.status;

    error.code =
      data?.code ||
      data?.errorCode ||
      data?.error_code ||
      data?.error ||
      "PAGAR_ERROR";

    error.requestId =
      requestId;

    console.error(
      "USDTMZ PAGAR ERROR:",
      {
        httpStatus:
          error.httpStatus,

        code:
          error.code,

        requestId:
          error.requestId,

        message:
          error.message,
      }
    );

    throw error;
  }

  return {
    data,
    requestId,
  };
}

/* =========================================================
   POST — MODO SIMULAÇÃO
========================================================= */

async function simulatePayment(
  sql,
  order
) {
  /*
   * Esta função NÃO chama a Pagar.
   *
   * Também não movimenta USDT real.
   */

  const simulationReference =
    `SIM-PAYMENT-${order.order_id}`;

  /*
   * Verifica se já existe
   * uma transação simulada para
   * este pedido.
   */

  const existing =
    await sql`
      SELECT
        id,
        reference,
        status
      FROM transactions
      WHERE reference =
        ${simulationReference}
      LIMIT 1
    `;

  if (
    existing.length > 0
  ) {
    return {
      alreadySimulated: true,
      transaction:
        existing[0],
    };
  }

  /*
   * Registra somente o pagamento
   * simulado.
   *
   * O saldo simulado já é tratado
   * pelo fluxo de simulação do order.js.
   */

  const transaction =
    await sql`
      INSERT INTO transactions (
        user_id,
        type,
        asset,
        amount,
        status,
        reference,
        blockchain_tx_hash,
        created_at
      )

      VALUES (
        ${order.phone},
        'SIMULATED_PAYMENT',
        'MZN',
        ${Number(order.amount)},
        'SIMULATED',
        ${simulationReference},
        NULL,
        NOW()
      )

      RETURNING
        id,
        user_id,
        type,
        asset,
        amount,
        status,
        reference,
        blockchain_tx_hash,
        created_at
    `;

  /*
   * Atualiza o pedido.
   */

  const updated =
    await sql`
      UPDATE orders

      SET
        status =
          'SIMULATED_PAID',

        updated_at =
          NOW()

      WHERE order_id =
        ${order.order_id}

      RETURNING
        id,
        order_id,
        amount,
        usdt_amount,
        rate,
        payment,
        status,
        updated_at
    `;

  return {
    alreadySimulated: false,

    transaction:
      transaction[0],

    order:
      updated[0],
  };
}

/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return json(res, 405, {
      success: false,
      error:
        "Método não permitido.",
    });
  }

  try {
    const sql =
      getSql();

    const {
      orderId
    } =
      req.body || {};

    if (!orderId) {
      return json(res, 400, {
        success: false,
        error:
          "orderId é obrigatório.",
      });
    }

    /* =====================================================
       BUSCAR PEDIDO
    ===================================================== */

    const rows =
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
          pagar_payment_id,
          mpesa_transaction_id,
          emola_transaction_id

        FROM orders

        WHERE order_id =
          ${String(orderId).trim()}

        LIMIT 1
      `;

    if (
      rows.length === 0
    ) {
      return json(res, 404, {
        success: false,
        error:
          "Pedido não encontrado.",
      });
    }

    const order =
      rows[0];

    /* =====================================================
       MODO SIMULAÇÃO
    ===================================================== */

    if (
      isSimulationMode()
    ) {
      /*
       * NÃO chama a Pagar.
       */

      const simulated =
        await simulatePayment(
          sql,
          order
        );

      return json(res, 200, {
        success: true,

        simulation: true,

        message:
          "Pagamento simulado confirmado.",

        payment: {
          id:
            `SIM-${order.order_id}`,

          status:
            "SIMULATED_PAID",
        },

        order: {
          orderId:
            order.order_id,

          amountMzn:
            Number(order.amount),

          usdtAmount:
            Number(
              order.usdt_amount
            ),

          rate:
            Number(order.rate),

          method:
            order.payment,

          status:
            simulated.order?.status ||
            "SIMULATED_PAID",
        },

        transaction:
          simulated.transaction,
      });
    }

    /* =====================================================
       A PARTIR DAQUI É O FLUXO PAGAR
    ===================================================== */

    if (!API_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "PAGAR_API_KEY não configurada.",
      });
    }

    if (!SIGNING_SECRET) {
      return json(res, 500, {
        success: false,
        error:
          "PAGAR_SIGNING_SECRET não configurada.",
      });
    }

    /* =====================================================
       PAGAMENTO JÁ CRIADO
    ===================================================== */

    if (
      order.pagar_payment_id
    ) {
      return json(res, 200, {
        success: true,

        alreadyCreated: true,

        payment: {
          id:
            order.pagar_payment_id,

          status:
            order.status,
        },

        order: {
          orderId:
            order.order_id,

          amountMzn:
            Number(order.amount),

          usdtAmount:
            Number(
              order.usdt_amount
            ),

          method:
            order.payment,
        },
      });
    }

    /* =====================================================
       ESTADOS BLOQUEADOS
    ===================================================== */

    if (
      order.status === "PAID" ||
      order.status === "COMPLETED" ||
      order.status === "CANCELLED" ||
      order.status === "FAILED"
    ) {
      return json(res, 409, {
        success: false,
        error:
          `O pedido está no estado ${order.status}.`,
      });
    }

    /* =====================================================
       VALOR
    ===================================================== */

    const amountMzn =
      Number(order.amount);

    if (
      !Number.isSafeInteger(
        amountMzn
      ) ||
      amountMzn <
        MIN_AMOUNT_MZN ||
      amountMzn >
        MAX_AMOUNT_MZN
    ) {
      return json(res, 400, {
        success: false,
        error:
          `O valor deve estar entre ${MIN_AMOUNT_MZN} e ${MAX_AMOUNT_MZN} MZN.`,
      });
    }

    /* =====================================================
       TELEFONE
    ===================================================== */

    const phone =
      String(
        order.phone || ""
      ).trim();

    if (
      !isValidPhone(phone)
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Número de telefone inválido.",
      });
    }

    /* =====================================================
       MÉTODO
    ===================================================== */

    const method =
      String(
        order.payment || ""
      )
        .trim()
        .toUpperCase();

    if (
      !isValidMethod(method)
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Método de pagamento inválido.",
      });
    }

    /* =====================================================
       CORPO PAGAR
    ===================================================== */

    const reference =
      String(
        order.order_id
      );

    const body = {
      reference,

      title:
        "Compra USDTMZ",

      description:
        `Compra de ${order.usdt_amount} USDT`,

      amountMzn,

      method,

      payerPhone:
        phone,
    };

    const idempotencyKey =
      `payment:${reference}`;

    /* =====================================================
       CHAMAR PAGAR
    ===================================================== */

    let result;

    try {
      result =
        await pagarPost(
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

          error:
            "A Pagar recusou a autenticação da API.",

          code:
            error.code ||
            "AUTH_ERROR",

          requestId:
            error.requestId ||
            null,
        });
      }

      if (
        error.httpStatus === 404
      ) {
        return json(res, 502, {
          success: false,

          error:
            "A rota de pagamentos da Pagar não foi encontrada.",

          code:
            error.code ||
            "PAGAR_ROUTE_NOT_FOUND",

          requestId:
            error.requestId ||
            null,
        });
      }

      if (
        error.httpStatus === 409
      ) {
        return json(res, 409, {
          success: false,

          error:
            "A Pagar informou um conflito para este pagamento.",

          code:
            error.code ||
            "CONFLICT",

          requestId:
            error.requestId ||
            null,
        });
      }

      if (
        error.httpStatus === 429
      ) {
        return json(res, 429, {
          success: false,

          error:
            "A Pagar limitou temporariamente os pedidos.",

          requestId:
            error.requestId ||
            null,
        });
      }

      console.error(
        "USDTMZ PAYMENT ERROR:",
        {
          code:
            error.code,

          httpStatus:
            error.httpStatus,

          requestId:
            error.requestId,

          message:
            error.message,
        }
      );

      return json(res, 502, {
        success: false,

        error:
          "Não foi possível iniciar o pagamento na Pagar.",

        code:
          error.code ||
          "PAGAR_ERROR",

        requestId:
          error.requestId ||
          null,
      });
    }

    /* =====================================================
       RESPOSTA PAGAR
    ===================================================== */

    const data =
      result.data || {};

    const pagarPaymentId =
      data.id ||
      data.paymentId ||
      data.payment_id ||
      data.payment?.id ||
      null;

    const providerTransactionId =
      data.transactionId ||
      data.transaction_id ||
      data.payment?.providerTransactionId ||
      null;

    if (
      !pagarPaymentId
    ) {
      return json(res, 502, {
        success: false,

        error:
          "A Pagar não devolveu o ID do pagamento.",

        requestId:
          result.requestId ||
          null,
      });
    }

    /* =====================================================
       GUARDAR PAGAR NO NEON
    ===================================================== */

    await sql`
      UPDATE orders

      SET
        pagar_payment_id =
          ${String(
            pagarPaymentId
          )},

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

        updated_at =
          NOW()

      WHERE order_id =
        ${reference}
    `;

    return json(res, 202, {
      success: true,

      simulation: false,

      message:
        "Pagamento iniciado. Aguarde a confirmação.",

      payment: {
        id:
          String(
            pagarPaymentId
          ),

        status:
          data.status ||
          data.paymentStatus ||
          data.payment?.status ||
          "PENDING",
      },

      order: {
        orderId:
          reference,

        amountMzn,

        usdtAmount:
          Number(
            order.usdt_amount
          ),

        method,
      },

      requestId:
        result.requestId ||
        null,
    });

  } catch (error) {

    console.error(
      "USDTMZ PAYMENT INTERNAL ERROR:",
      {
        code:
          error?.code,

        message:
          error?.message,

        httpStatus:
          error?.httpStatus,

        requestId:
          error?.requestId,
      }
    );

    return json(res, 500, {
      success: false,

      error:
        "Erro interno ao iniciar o pagamento.",
    });
  }
}
