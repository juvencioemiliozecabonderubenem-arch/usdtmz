import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

const sql = neon(process.env.DATABASE_URL);

const SESSION_COOKIE = "usdtmz_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 horas

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password, "utf8")
    .digest("hex");
}

function createSession(adminId) {
  const timestamp = Date.now().toString();

  const payload = `${adminId}.${timestamp}`;

  const signature = crypto
    .createHmac("sha256", process.env.ADMIN_SESSION_SECRET)
    .update(payload)
    .digest("hex");

  return Buffer
    .from(`${payload}.${signature}`)
    .toString("base64url");
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

    if (!process.env.ADMIN_SESSION_SECRET) {
      return json(res, 500, {
        success: false,
        error: "ADMIN_SESSION_SECRET não configurada."
      });
    }

    const body = req.body || {};

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    if (!email || !password) {
      return json(res, 400, {
        success: false,
        error: "Informe o e-mail e a senha."
      });
    }

    const result = await sql`
      SELECT
        id,
        email,
        password_hash
      FROM admins
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;

    if (!result.length) {
      return json(res, 401, {
        success: false,
        error: "E-mail ou senha incorretos."
      });
    }

    const admin = result[0];

    const suppliedHash = hashPassword(password);
    const storedHash = String(admin.password_hash || "");

    const suppliedBuffer = Buffer.from(
      suppliedHash,
      "utf8"
    );

    const storedBuffer = Buffer.from(
      storedHash,
      "utf8"
    );

    let passwordCorrect = false;

    if (
      suppliedBuffer.length ===
      storedBuffer.length
    ) {
      passwordCorrect = crypto.timingSafeEqual(
        suppliedBuffer,
        storedBuffer
      );
    }

    if (!passwordCorrect) {
      return json(res, 401, {
        success: false,
        error: "E-mail ou senha incorretos."
      });
    }

    const session = createSession(admin.id);

    const secure =
      process.env.NODE_ENV === "production"
        ? "; Secure"
        : "";

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${session}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${secure}`
    );

    return json(res, 200, {
      success: true,
      message: "Login realizado com sucesso.",
      admin: {
        id: admin.id,
        email: admin.email
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
