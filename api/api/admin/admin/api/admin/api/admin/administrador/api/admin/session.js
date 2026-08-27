import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const sql = neon(process.env.DATABASE_URL);

const SESSION_COOKIE = "usdtmz_admin_session";
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function parseCookies(cookieHeader) {
  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = value;
  }

  return cookies;
}

function verifySession(token) {
  try {
    if (!token) {
      return null;
    }

    const separator = token.lastIndexOf(".");

    if (separator <= 0) {
      return null;
    }

    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    if (!encoded || !signature) {
      return null;
    }

    const secret =
      process.env.ADMIN_SESSION_SECRET;

    if (!secret) {
      return null;
    }

    const expectedSignature =
      crypto
        .createHmac("sha256", secret)
        .update(encoded)
        .digest("base64url");

    const suppliedBuffer =
      Buffer.from(signature, "utf8");

    const expectedBuffer =
      Buffer.from(expectedSignature, "utf8");

    if (
      suppliedBuffer.length !==
      expectedBuffer.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        suppliedBuffer,
        expectedBuffer
      )
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        Buffer
          .from(encoded, "base64url")
          .toString("utf8")
      );

    if (!payload?.id || !payload?.exp) {
      return null;
    }

    if (Date.now() > Number(payload.exp)) {
      return null;
    }

    return payload;

  } catch (error) {

    console.error(
      "SESSION VERIFY ERROR:",
      error?.message || error
    );

    return null;
  }
}

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return json(res, 405, {
      success: false,
      authenticated: false,
      error: "Método não permitido."
    });
  }

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      authenticated: false,
      error: "DATABASE_URL não configurada."
    });
  }

  if (!process.env.ADMIN_SESSION_SECRET) {
    return json(res, 500, {
      success: false,
      authenticated: false,
      error: "ADMIN_SESSION_SECRET não configurada."
    });
  }

  try {

    const cookies =
      parseCookies(
        req.headers.cookie
      );

    const token =
      cookies[SESSION_COOKIE];

    const session =
      verifySession(token);

    if (!session) {

      return json(res, 401, {
        success: false,
        authenticated: false,
        error: "Sessão inválida ou expirada."
      });
    }

    const result =
      await sql`
        SELECT
          id,
          email,
          active
        FROM admin_users
        WHERE id = ${session.id}
        LIMIT 1
      `;

    if (!result.length) {

      return json(res, 401, {
        success: false,
        authenticated: false,
        error: "Administrador não encontrado."
      });
    }

    const admin = result[0];

    if (!admin.active) {

      return json(res, 403, {
        success: false,
        authenticated: false,
        error: "Conta administrativa desativada."
      });
    }

    return json(res, 200, {
      success: true,
      authenticated: true,
      admin: {
        id: admin.id,
        email: admin.email
      }
    });

  } catch (error) {

    console.error(
      "ADMIN SESSION ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      authenticated: false,
      error: "Erro interno ao verificar a sessão."
    });
  }
}
