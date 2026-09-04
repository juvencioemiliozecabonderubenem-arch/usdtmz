import { neon } from "@neondatabase/serverless";
import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

const ADMIN_COOKIE_NAME = "usdtmz_admin_session";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  for (const item of header.split(";")) {
    const cookie = item.trim();
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
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret) {
    return null;
  }

  const token = getCookie(req, ADMIN_COOKIE_NAME);

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

function getBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

export default async function handler(req, res) {
  // =====================================================
  // AUTENTICAÇÃO ADMIN
  // =====================================================

  const admin = verifyAdminSession(req);

  if (!admin) {
    return json(res, 401, {
      success: false,
      error: "Não autorizado."
    });
  }

  // =====================================================
  // DATABASE
  // =====================================================

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada."
    });
  }

  const sql = neon(
    process.env.DATABASE_URL
  );

  try {
    // ===================================================
    // GET — LISTAR RETIRADAS
    // ===================================================

    if (req.method === "GET") {
      const result = await sql`
        SELECT
          withdrawal_id,
          user_id,
          destination_address,
          amount_to_send,
          asset,
          network,
          status,
          tx_hash,
          created_at,
          updated_at
        FROM withdrawals
        ORDER BY created_at DESC
        LIMIT 500
      `;

      return json(res, 200, {
        success: true,
        withdrawals: result
      });
    }

    // ===================================================
    // POST — AUTORIZAR / REJEITAR
    // ===================================================

    if (req.method !== "POST") {
      res.setHeader(
        "Allow",
        "GET, POST"
      );

      return json(res, 405, {
        success: false,
        error: "Método não permitido."
      });
    }

    const body = getBody(req);

    const action = String(
      body.action || ""
    )
      .trim()
      .toLowerCase();

    const withdrawalId = String(
      body.withdrawal_id || ""
    ).trim();

    if (!withdrawalId) {
      return json(res, 400, {
        success: false,
        error: "withdrawal_id é obrigatório."
      });
    }

    if (
      action !== "authorize" &&
      action !== "reject"
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Ação inválida. Use authorize ou reject."
      });
    }

    // ===================================================
    // AUTORIZAR
    // PENDING → AUTHORIZED
    // ===================================================

    if (action === "authorize") {
      const result = await sql`
        UPDATE withdrawals
        SET
          status = 'AUTHORIZED',
          updated_at = NOW()
        WHERE
          withdrawal_id = ${withdrawalId}
          AND status = 'PENDING'
        RETURNING
          withdrawal_id,
          user_id,
          destination_address,
          amount_to_send,
          asset,
          network,
          status,
          tx_hash,
          created_at,
          updated_at
      `;

      if (result.length === 0) {
        const existing = await sql`
          SELECT
            withdrawal_id,
            status
          FROM withdrawals
          WHERE withdrawal_id = ${withdrawalId}
          LIMIT 1
        `;

        if (existing.length === 0) {
          return json(res, 404, {
            success: false,
            error: "Retirada não encontrada."
          });
        }

        return json(res, 409, {
          success: false,
          error:
            `A retirada não está PENDING. Estado atual: ${existing[0].status}.`
        });
      }

      return json(res, 200, {
        success: true,
        message: "Retirada autorizada.",
        withdrawal: result[0]
      });
    }

    // ===================================================
    // REJEITAR
    // PENDING → REJECTED
    // ===================================================

    if (action === "reject") {
      const result = await sql`
        UPDATE withdrawals
        SET
          status = 'REJECTED',
          updated_at = NOW()
        WHERE
          withdrawal_id = ${withdrawalId}
          AND status = 'PENDING'
        RETURNING
          withdrawal_id,
          user_id,
          destination_address,
          amount_to_send,
          asset,
          network,
          status,
          tx_hash,
          created_at,
          updated_at
      `;

      if (result.length === 0) {
        const existing = await sql`
          SELECT
            withdrawal_id,
            status
          FROM withdrawals
          WHERE withdrawal_id = ${withdrawalId}
          LIMIT 1
        `;

        if (existing.length === 0) {
          return json(res, 404, {
            success: false,
            error: "Retirada não encontrada."
          });
        }

        return json(res, 409, {
          success: false,
          error:
            `A retirada não está PENDING. Estado atual: ${existing[0].status}.`
        });
      }

      return json(res, 200, {
        success: true,
        message: "Retirada rejeitada.",
        withdrawal: result[0]
      });
    }

  } catch (error) {
    console.error(
      "withdrawals-admin error:",
      error
    );

    return json(res, 500, {
      success: false,
      error: "Erro interno do servidor."
    });
  }
}
