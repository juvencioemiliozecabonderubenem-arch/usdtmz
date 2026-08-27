import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

const sql = neon(process.env.DATABASE_URL);

const SESSION_COOKIE = "usdtmz_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 8;

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function parseCookies(cookieHeader) {

  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader
    .split(";")
    .forEach(part => {

      const index = part.indexOf("=");

      if (index === -1) {
        return;
      }

      const key = part
        .slice(0, index)
        .trim();

      const value = part
        .slice(index + 1)
        .trim();

      cookies[key] = value;
    });

  return cookies;
}

function verifySession(token) {

  try {

    if (!token) {
      return null;
    }

    const decoded =
      Buffer
        .from(token, "base64url")
        .toString("utf8");

    const parts = decoded.split(".");

    if (parts.length !== 3) {
      return null;
    }

    const adminId = parts[0];
    const timestamp = parts[1];
    const signature = parts[2];

    if (!adminId || !timestamp || !signature) {
      return null;
    }

    const timestampNumber =
      Number(timestamp);

    if (!Number.isFinite(timestampNumber)) {
      return null;
    }

    const age =
      Date.now() - timestampNumber;

    if (
      age < 0 ||
      age > SESSION_MAX_AGE * 1000
    ) {
      return null;
    }

    const payload =
      `${adminId}.${timestamp}`;

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          process.env.ADMIN_SESSION_SECRET
        )
        .update(payload)
        .digest("hex");

    const suppliedBuffer =
      Buffer.from(
        signature,
        "utf8"
      );

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "utf8"
      );

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

    return Number(adminId);

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

  try {

    if (!process.env.ADMIN_SESSION_SECRET) {
      return json(res, 500, {
        success: false,
        error:
          "ADMIN_SESSION_SECRET não configurada."
      });
    }

    const cookies =
      parseCookies(
        req.headers.cookie
      );

    const token =
      cookies[SESSION_COOKIE];

    const adminId =
      verifySession(token);

    if (!adminId) {

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
          created_at
        FROM admins
        WHERE id = ${adminId}
        LIMIT 1
      `;

    if (!result.length) {

      return json(res, 401, {
        success: false,
        authenticated: false,
        error: "Administrador não encontrado."
      });

    }

    return json(res, 200, {
      success: true,
      authenticated: true,
      admin: {
        id: result[0].id,
        email: result[0].email,
        created_at: result[0].created_at
      }
    });

  } catch (error) {

    console.error(
      "ADMIN SESSION ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error: "Erro ao verificar sessão."
    });

  }
}
