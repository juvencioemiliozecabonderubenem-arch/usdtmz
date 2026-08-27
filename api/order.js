import { neon } from "@neondatabase/serverless";
import { createHmac, timingSafeEqual } from "node:crypto";

const RATE = 50;

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* =========================
   SESSÃO ADMIN
========================= */

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  const cookies = header
    .split(";")
    .map(item => item.trim());

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");

    if (index === -1) continue;

    const key = cookie.slice(0, index);
    const value = cookie.slice(index + 1);

    if (key === name) {
      return value;
    }
  }

  return null;
}

function verifyAdminSession(req) {
  const secret =
    process.env.ADMIN_SESSION_SECRET;

  if (!secret) {
    return null;
  }

  const token =
    getCookie(
      req,
      "usdtmz_admin_session"
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

    const expectedSignature =
      createHmac(
        "sha256",
        secret
      )
        .update(encoded)
        .digest("base64url");

    const received =
      Buffer.from(
        receivedSignature,
        "utf8"
      );

    const expected =
      Buffer.from(
        expectedSignature,
        "utf8"
      );

    if (
      received.length !==
      expected.length
    ) {
      return null;
    }

    if (
      !timingSafeEqual(
        received,
        expected
      )
    ) {
      return null;
    }

    const payload =
      JSON.parse(
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
      Date.now() >=
      Number(payload.exp)
    ) {
      return null;
    }

    return payload;

  } catch {
    return null;
  }
}

/* =========================
   GET — ADMIN
========================= */

async function getOrders(req, res, sql) {

  const admin =
    verifyAdminSession(req);

  if (!admin) {
    return json(res, 401, {
      success: false,
      error:
        "Não autorizado."
    });
  }

  const result =
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
        created_at

      FROM orders

      ORDER BY created_at DESC

      LIMIT 500

    `;

  return json(res, 200, {

    success: true,

    orders: result

  });
}

/* =========================
   POST — CRIAR PEDIDO
========================= */

async function createOrder(req, res, sql) {

  const body =
    req.body || {};

  const phone =
    String(
      body.phone || ""
    ).trim();

  const payment =
    String(
      body.payment_method ||
      body.payment ||
      ""
    )
      .trim()
      .toLowerCase();

  const operation =
    String(
      body.operation ||
      "buy"
    )
      .trim()
      .toLowerCase();

  const name =
    String(
      body.name ||
      "Cliente"
    ).trim();

  const amountInput =
    body.amount_mzn ??
    body.amount ??
    body.amountMzn;

  if (!phone) {

    return json(res, 400, {
      success: false,
      error:
        "Informe o número de telefone."
    });

  }

  if (
    !["mpesa", "emola"]
      .includes(payment)
  ) {

    return json(res, 400, {
      success: false,
      error:
        "Escolha M-Pesa ou e-Mola."
    });

  }

  if (operation !== "buy") {

    return json(res, 400, {
      success: false,
      error:
        "Operação inválida."
    });

  }

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

  const amount =
    Number(amountInput);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    return json(res, 400, {
      success: false,
      error:
        "Valor em MZN inválido."
    });

  }

  const usdtAmount =
    amount / RATE;

  const orderId =
    "USDTMZ-" +
    Date.now()
      .toString(36)
      .toUpperCase();

  const result =
    await sql`

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
        'PENDING'

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

  const order =
    result[0];

  return json(res, 201, {

    success: true,

    message:
      "Pedido criado com sucesso.",

    order: {

      id:
        order.id,

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
        order.amount,

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

    }

  });
}

/* =========================
   HANDLER
========================= */

export default async function handler(req, res) {

  if (!["GET", "POST"].includes(req.method)) {

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

    const sql =
      neon(
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
      error?.message ||
      error
    );

    return json(res, 500, {

      success: false,

      error:
        "Erro interno ao processar o pedido."

    });

  }
}
