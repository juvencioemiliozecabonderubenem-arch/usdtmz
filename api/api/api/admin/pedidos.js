import { neon } from "@neondatabase/serverless";
import { createHmac, timingSafeEqual } from "node:crypto";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  for (const part of cookieHeader.split(";")) {
    const item = part.trim();
    const index = item.indexOf("=");

    if (index === -1) continue;

    const key = item.slice(0, index);
    const value = item.slice(index + 1);

    if (key === name) {
      return value;
    }
  }

  return null;
}

function verifySession(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret) return null;

  const token = getCookie(
    req,
    "usdtmz_admin_session"
  );

  if (!token) return null;

  try {
    const parts = token.split(".");

    if (parts.length !== 2) return null;

    const encoded = parts[0];
    const received = parts[1];

    const expected = createHmac(
      "sha256",
      secret
    )
      .update(encoded)
      .digest("base64url");

    const a = Buffer.from(received);
    const b = Buffer.from(expected);

    if (a.length !== b.length) {
      return null;
    }

    if (!timingSafeEqual(a, b)) {
      return null;
    }

    const session = JSON.parse(
      Buffer.from(
        encoded,
        "base64url"
      ).toString("utf8")
    );

    if (!session?.id || !session?.email) {
      return null;
    }

    if (
      !session.exp ||
      Date.now() >= Number(session.exp)
    ) {
      return null;
    }

    return session;

  } catch {
    return null;
  }
}

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error:
        "DATABASE_URL não configurada."
    });
  }

  const admin = verifySession(req);

  if (!admin) {
    return json(res, 401, {
      success: false,
      error:
        "Sessão administrativa inválida ou expirada."
    });
  }

  try {

    const sql =
      neon(process.env.DATABASE_URL);

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
      orders
    });

  } catch (error) {

    console.error(
      "ADMIN ORDERS ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro ao carregar os pedidos."
    });
  }
}
