import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const sql = neon(process.env.DATABASE_URL);

const COOKIE_NAME = "usdtmz_admin_session";
const SESSION_HOURS = 12;

function json(res, status, data) {
  return res.status(status).json(data);
}

function parseBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_HOURS * 60 * 60;

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido.",
    });
  }

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada.",
    });
  }

  try {
    const body = parseBody(req);

    const email = String(
      body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password || ""
    );

    if (!email || !password) {
      return json(res, 400, {
        success: false,
        error: "Email e senha são obrigatórios.",
      });
    }

    /*
     * Procurar administrador ativo.
     */
    const users = await sql`
      SELECT
        id,
        email,
        password_hash,
        active
      FROM admin_users
      WHERE LOWER(email) = ${email}
        AND active = true
      LIMIT 1
    `;

    if (users.length === 0) {
      return json(res, 401, {
        success: false,
        error: "Email ou senha incorretos.",
      });
    }

    const admin = users[0];

    /*
     * IMPORTANTE:
     *
     * Este arquivo espera que password_hash
     * seja um hash compatível com o método
     * de autenticação configurado no projeto.
     *
     * Não comparamos a senha em texto puro.
     */

    const storedHash = String(
      admin.password_hash || ""
    );

    /*
     * Neste primeiro passo não vamos aceitar
     * "SEU_HASH" como senha real.
     *
     * O hash precisa ser configurado corretamente
     * antes de ativar o login.
     */
    if (
      !storedHash ||
      storedHash === "SEU_HASH"
    ) {
      return json(res, 500, {
        success: false,
        error:
          "A senha do administrador ainda não está configurada com um hash válido.",
      });
    }

    /*
     * Neste ponto precisamos conhecer o formato
     * real do hash para fazer a verificação correta.
     *
     * Por segurança, não fazemos fallback para
     * comparação de senha em texto puro.
     */

    return json(res, 501, {
      success: false,
      error:
        "O formato do password_hash precisa ser configurado antes de ativar o login.",
    });
  } catch (error) {
    console.error(
      "ADMIN LOGIN ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      error: "Erro interno no login.",
    });
  }
}
