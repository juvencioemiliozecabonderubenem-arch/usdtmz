import { neon } from "@neondatabase/serverless";
import {
  createHmac,
  timingSafeEqual,
  randomBytes
} from "node:crypto";

const RATE = 50;
const MIN_AMOUNT_MZN = 20;
const MAX_AMOUNT_MZN = 40000;

const ADMIN_COOKIE_NAME = "usdtmz_admin_session";

/*
 * =========================================================
 * USDTMZ — ORDER API
 *
 * DATABASE:
 *   Neon PostgreSQL
 *
 * IMPORTANTE:
 *   A simulação NÃO movimenta dinheiro real.
 *   A simulação só pode ser ativada através de:
 *
 *   USDTMZ_SIMULATION_MODE=true
 *
 * Quando desligado:
 *
 *   pedido -> PENDING
 *
 * Quando ligado:
 *
 *   pedido
 *      ↓
 *   pagamento SIMULADO
 *      ↓
 *   saldo SIMULADO no Neon
 *
 * Nenhuma transação blockchain é executada aqui.
 * =========================================================
 */

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* =========================================================
   COOKIE
========================================================= */

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  const cookies = header
    .split(";")
    .map(item => item.trim());

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = cookie.slice(0, index);
    const value = cookie.slice(index + 1);

    if (key === name) {
      return value;
    }
  }

  return null;
}

/* =========================================================
   SESSÃO ADMIN
========================================================= */

function verifyAdminSession(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret) {
    return null;
  }

  const token = getCookie(
    req,
    ADMIN_COOKIE_NAME
  );

  if (!token) {
    return null;
  }

  try {
    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const encoded = parts[0];
    const receivedSignature = parts[1];

    const expectedSignature = createHmac(
      "sha256",
      secret
    )
      .update(encoded)
      .digest("base64url");

    const received = Buffer.from(
      receivedSignature,
      "utf8"
    );

    const expected = Buffer.from(
      expectedSignature,
      "utf8"
    );

    if (received.length !== expected.length) {
      return null;
    }

    if (!timingSafeEqual(received, expected)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(
        encoded,
        "base64url"
      ).toString("utf8")
    );

    if (
      !payload ||
      !payload.id ||
      !payload.email ||
      !payload.exp
    ) {
      return null;
    }

    if (
      Date.now() >= Number(payload.exp)
    ) {
      return null;
    }

    return payload;

  } catch {
    return null;
  }
}

/* =========================================================
   GET — LISTAR PEDIDOS
========================================================= */

async function getOrders(req, res, sql) {
  const admin = verifyAdminSession(req);

  if (!admin) {
    return json(res, 401, {
      success: false,
      error: "Não autorizado."
    });
  }

  const result = await sql`
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
      emola_transaction_id,
      blockchain_tx_hash,
      wallet_address,
      created_at,
      updated_at

    FROM orders

    ORDER BY created_at DESC

    LIMIT 500
  `;

  return json(res, 200, {
    success: true,
    orders: result
  });
}

/* =========================================================
   TELEFONE
========================================================= */

function isValidPhone(phone) {
  return /^\d{9}$/.test(phone);
}

/* =========================================================
   ID DO PEDIDO
========================================================= */

function createOrderId() {
  const randomPart = randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return (
    "USDTMZ-" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    "-" +
    randomPart
  );
}

/* =========================================================
   MODO SIMULAÇÃO
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
   CRIAR / ATUALIZAR SALDO SIMULADO
========================================================= */

async function creditSimulationBalance(
  sql,
  userId,
  usdtAmount
) {
  /*
   * O user_id usado na simulação é o telefone.
   *
   * Isto é apenas para a etapa de teste.
   */

  const existing = await sql`
    SELECT
      id,
      user_id,
      usdt_balance
    FROM balances
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    const currentBalance =
      Number(existing[0].usdt_balance || 0);

    const newBalance =
      currentBalance + usdtAmount;

    const updated = await sql`
      UPDATE balances

      SET
        usdt_balance = ${newBalance},
        updated_at = NOW()

      WHERE id = ${existing[0].id}

      RETURNING
        id,
        user_id,
        usdt_balance,
        updated_at
    `;

    return updated[0];
  }

  const created = await sql`
    INSERT INTO balances (
      user_id,
      usdt_balance,
      created_at,
      updated_at
    )

    VALUES (
      ${userId},
      ${usdtAmount},
      NOW(),
      NOW()
    )

    RETURNING
      id,
      user_id,
      usdt_balance,
      updated_at
  `;

  return created[0];
}

/* =========================================================
   TRANSAÇÃO SIMULADA
========================================================= */

async function createSimulationTransaction(
  sql,
  userId,
  orderId,
  usdtAmount
) {
  /*
   * Registra a entrada SIMULADA no ledger.
   *
   * Não existe blockchain envolvida.
   */

  const reference =
    `SIMULATION-${orderId}`;

  const result = await sql`
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
      ${userId},
      'SIMULATED_DEPOSIT',
      'USDT',
      ${usdtAmount},
      'SIMULATED',
      ${reference},
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
      created_at
  `;

  return result[0];
}

/* =========================================================
   POST — CRIAR PEDIDO
========================================================= */

async function createOrder(req, res, sql) {
  const body = req.body || {};

  const phone = String(
    body.phone || ""
  ).trim();

  const payment = String(
    body.payment_method ||
    body.payment ||
    ""
  )
    .trim()
    .toLowerCase();

  const operation = String(
    body.operation || "buy"
  )
    .trim()
    .toLowerCase();

  const name = String(
    body.name || "Cliente"
  ).trim();

  const amountInput =
    body.amount_mzn ??
    body.amount ??
    body.amountMzn;

  /* =======================================================
     TELEFONE
  ======================================================= */

  if (!phone) {
    return json(res, 400, {
      success: false,
      error:
        "Informe o número de telefone."
    });
  }

  if (!isValidPhone(phone)) {
    return json(res, 400, {
      success: false,
      error:
        "Número de telefone inválido. Use 9 dígitos."
    });
  }

  /* =======================================================
     PAGAMENTO
  ======================================================= */

  if (
    !["mpesa", "emola"].includes(payment)
  ) {
    return json(res, 400, {
      success: false,
      error:
        "Escolha M-Pesa ou e-Mola."
    });
  }

  /* =======================================================
     OPERAÇÃO
  ======================================================= */

  if (operation !== "buy") {
    return json(res, 400, {
      success: false,
      error:
        "Operação inválida."
    });
  }

  /* =======================================================
     VALOR
  ======================================================= */

  if (
    amountInput === undefined ||
    amountInput === null ||
    amountInput === ""
  ) {
    return json(res, 400, {
      success: false,
      error:
        "Informe o valor em MZN."
    });
  }

  const amount = Number(amountInput);

  if (!Number.isSafeInteger(amount)) {
    return json(res, 400, {
      success: false,
      error:
        "O valor em MZN deve ser um número inteiro."
    });
  }

  if (amount < MIN_AMOUNT_MZN) {
    return json(res, 400, {
      success: false,
      error:
        `O valor mínimo é ${MIN_AMOUNT_MZN} MZN.`
    });
  }

  if (amount > MAX_AMOUNT_MZN) {
    return json(res, 400, {
      success: false,
      error:
        `O valor máximo é ${MAX_AMOUNT_MZN} MZN.`
    });
  }

  /* =======================================================
     CÁLCULO USDT
  ======================================================= */

  const usdtAmount =
    amount / RATE;

  if (
    !Number.isFinite(usdtAmount) ||
    usdtAmount <= 0
  ) {
    return json(res, 400, {
      success: false,
      error:
        "Não foi possível calcular o valor USDT."
    });
  }

  /* =======================================================
     ID
  ======================================================= */

  const orderId =
    createOrderId();

  /* =======================================================
     STATUS INICIAL
  ======================================================= */

  const simulation =
    isSimulationMode();

  /*
   * Sem simulação:
   *
   * PENDING
   *
   * Com simulação:
   *
   * SIMULATED_PAID
   */

  const initialStatus =
    simulation
      ? "SIMULATED_PAID"
      : "PENDING";

  /* =======================================================
     CRIAR PEDIDO
  ======================================================= */

  const result = await sql`
    INSERT INTO orders (
      order_id,
      name,
      phone,
      operation,
      payment,
      amount,
      usdt_amount,
      rate,
      status
    )

    VALUES (
      ${orderId},
      ${name},
      ${phone},
      ${operation},
      ${payment},
      ${amount},
      ${usdtAmount},
      ${RATE},
      ${initialStatus}
    )

    RETURNING
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
      created_at
  `;

  const order = result[0];

  /* =======================================================
     SIMULAÇÃO
  ======================================================= */

  let simulatedBalance = null;
  let simulatedTransaction = null;

  if (simulation) {

    /*
     * 1. Credita saldo SIMULADO.
     */

    simulatedBalance =
      await creditSimulationBalance(
        sql,
        phone,
        usdtAmount
      );

    /*
     * 2. Registra movimento SIMULADO.
     */

    simulatedTransaction =
      await createSimulationTransaction(
        sql,
        phone,
        orderId,
        usdtAmount
      );
  }

  /* =======================================================
     RESPOSTA
  ======================================================= */

  return json(res, 201, {
    success: true,

    simulation,

    message: simulation
      ? "Pedido criado e pagamento simulado confirmado."
      : "Pedido criado com sucesso.",

    order: {
      id: order.id,

      order_id:
        order.order_id,

      name:
        order.name,

      phone:
        order.phone,

      operation:
        order.operation,

      payment:
        order.payment,

      amount:
        Number(order.amount),

      usdt_amount:
        Number(
          order.usdt_amount
        ).toFixed(6),

      rate:
        Number(order.rate),

      status:
        order.status,

      created_at:
        order.created_at
    },

    simulated: simulation
      ? {
          payment_status:
            "SIMULATED_PAID",

          usdt_credited:
            Number(usdtAmount)
              .toFixed(6),

          balance:
            Number(
              simulatedBalance.usdt_balance
            ).toFixed(6),

          transaction:
            simulatedTransaction
        }
      : null
  });
}

/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    !["GET", "POST"].includes(
      req.method
    )
  ) {
    return json(res, 405, {
      success: false,
      error:
        "Método não permitido."
    });
  }

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error:
        "DATABASE_URL não configurada no Vercel."
    });
  }

  try {

    const sql = neon(
      process.env.DATABASE_URL
    );

    if (req.method === "GET") {
      return await getOrders(
        req,
        res,
        sql
      );
    }

    return await createOrder(
      req,
      res,
      sql
    );

  } catch (error) {

    console.error(
      "USDTMZ ORDER ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao processar o pedido."
    });
  }
}
