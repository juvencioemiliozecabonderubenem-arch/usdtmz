import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function verifyPassword(password, stored) {

  const [salt, originalHash] =
    String(stored).split(":");

  if (!salt || !originalHash) {
    return false;
  }

  const hash =
    crypto.scryptSync(
      password,
      salt,
      64
    ).toString("hex");

  const a =
    Buffer.from(hash, "hex");

  const b =
    Buffer.from(originalHash, "hex");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function setCookie(res, token) {

  const cookie =
    [
      `usdtmz_admin=${token}`,
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=28800"
    ].join("; ");

  res.setHeader(
    "Set-Cookie",
    cookie
  );
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido. Use POST."
    });
  }

  try {

    if (!process.env.DATABASE_URL) {
      return json(res, 500, {
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    const body = req.body || {};

    const email =
      String(body.email || "")
        .trim()
        .toLowerCase();

    const password =
      String(body.password || "");

    if (!email || !password) {
      return json(res, 400, {
        success: false,
        error:
          "Informe email e senha."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);

    const users =
      await sql`
        SELECT
          id,
          email,
          password_hash,
          active
        FROM admin_users
        WHERE email = ${email}
        LIMIT 1
      `;

    if (
      !users.length ||
      !users[0].active
    ) {
      return json(res, 401, {
        success: false,
        error:
          "Email ou senha incorretos."
      });
    }

    const user = users[0];

    if (
      !verifyPassword(
        password,
        user.password_hash
      )
    ) {
      return json(res, 401, {
        success: false,
        error:
          "Email ou senha incorretos."
      });
    }

    const token =
      createToken();

    const tokenHash =
      hashToken(token);

    await sql`
      DELETE FROM admin_sessions
      WHERE expires_at < CURRENT_TIMESTAMP
    `;

    await sql`
      INSERT INTO admin_sessions (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (
        ${user.id},
        ${tokenHash},
        CURRENT_TIMESTAMP + INTERVAL '8 hours'
      )
    `;

    setCookie(res, token);

    return json(res, 200, {
      success: true,
      message: "Login efetuado.",
      user: {
        id: user.id,
        email: user.email
      }
    });

  } catch (error) {

    console.error(
      "ADMIN LOGIN ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error: "Erro interno no login."
    });
  }
}
