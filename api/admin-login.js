// /api/admin-login.js
//
// USDTMZ — ADMIN LOGIN
//
// Autenticação administrativa usando exclusivamente NEON.
//
// FLUXO:
//
// Email + senha
//      ↓
// admin_users
//      ↓
// verificar password_hash com scrypt
//      ↓
// criar token aleatório
//      ↓
// guardar SHA-256(token) em admin_sessions
//      ↓
// devolver token ao navegador
//
// IMPORTANTE:
// - Supabase NÃO é utilizado.
// - A senha nunca é armazenada em texto puro.
// - O password_hash usa scrypt.
// - O token da sessão é aleatório.
// - No banco é armazenado somente SHA-256 do token.
// - Compatível com admin-me.js e admin-dashboard.js.
//

import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const COOKIE_NAME = "usdtmz_admin_session";
const SESSION_HOURS = 12;

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function parseBody(req) {
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

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

/*
 * Verifica password_hash no formato:
 *
 * scrypt$N$r$p$salt$derivedKey
 *
 * Exemplo estrutural:
 *
 * scrypt$16384$8$1$SAL...$HASH...
 *
 * O salt e o hash são armazenados
 * dentro do password_hash.
 */
async function verifyScryptPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");

  if (parts.length !== 6) {
    return false;
  }

  const [
    algorithm,
    nString,
    rString,
    pString,
    saltHex,
    keyHex
  ] = parts;

  if (algorithm !== "scrypt") {
    return false;
  }

  const N = Number(nString);
  const r = Number(rString);
  const p = Number(pString);

  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N <= 1 ||
    r <= 0 ||
    p <= 0
  ) {
    return false;
  }

  /*
   * Evita parâmetros absurdamente grandes
   * vindos diretamente do banco.
   */
  if (N > 1048576) {
    return false;
  }

  if (!/^[0-9a-fA-F]+$/.test(saltHex)) {
    return false;
  }

  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");

  if (salt.length === 0 || expectedKey.length === 0) {
    return false;
  }

  try {
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.scrypt(
        password,
        salt,
        expectedKey.length,
        {
          N,
          r,
          p,
          maxmem: Math.max(
            128 * N * r + 1024,
            32 * 1024 * 1024
          )
        },
        (error, key) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(key);
        }
      );
    });

    if (!Buffer.isBuffer(derivedKey)) {
      return false;
    }

    if (derivedKey.length !== expectedKey.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      derivedKey,
      expectedKey
    );
  } catch (error) {
    console.error(
      "ADMIN LOGIN SCRYPT ERROR:",
      error?.message || error
    );

    return false;
  }
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_HOURS * 60 * 60;

  res.setHeader(
    "Set-Cookie",
    [
      `${COOKIE_NAME}=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      `Max-Age=${maxAge}`
    ].join("; ")
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error(
      "ADMIN LOGIN: DATABASE_URL não configurada."
    );

    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada."
    });
  }

  try {
    const sql = neon(DATABASE_URL);

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
        error: "Email e senha são obrigatórios."
      });
    }

    /*
     * Limite básico para evitar entradas
     * anormalmente grandes.
     */
    if (email.length > 254) {
      return json(res, 400, {
        success: false,
        error: "Email inválido."
      });
    }

    if (password.length > 1024) {
      return json(res, 400, {
        success: false,
        error: "Senha inválida."
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

    /*
     * Não revelar se o email existe.
     */
    if (users.length === 0) {
      return json(res, 401, {
        success: false,
        error: "Email ou senha incorretos."
      });
    }

    const admin = users[0];

    const storedHash = String(
      admin.password_hash || ""
    );

    /*
     * O placeholder antigo não pode ser usado
     * como credencial.
     */
    if (
      !storedHash ||
      storedHash === "SEU_HASH"
    ) {
      console.error(
        "ADMIN LOGIN: password_hash ainda não configurado."
      );

      return json(res, 500, {
        success: false,
        error:
          "A senha administrativa ainda não foi configurada."
      });
    }

    /*
     * Verificar senha com scrypt.
     */
    const passwordValid =
      await verifyScryptPassword(
        password,
        storedHash
      );

    if (!passwordValid) {
      return json(res, 401, {
        success: false,
        error: "Email ou senha incorretos."
      });
    }

    /*
     * Criar novo token de sessão.
     */
    const sessionToken =
      createSessionToken();

    /*
     * Nunca guardar o token original
     * no banco.
     */
    const tokenHash =
      sha256(sessionToken);

    /*
     * Expiração da sessão.
     */
    const expiresAt =
      new Date(
        Date.now() +
          SESSION_HOURS *
            60 *
            60 *
            1000
      );

    /*
     * Remover sessões anteriores
     * expiradas deste administrador.
     */
    await sql`
      DELETE FROM admin_sessions
      WHERE user_id = ${admin.id}
        AND expires_at <= NOW()
    `;

    /*
     * Criar nova sessão.
     */
    await sql`
      INSERT INTO admin_sessions (
        user_id,
        token_hash,
        expires_at,
        created_at
      )
      VALUES (
        ${admin.id},
        ${tokenHash},
        ${expiresAt},
        NOW()
      )
    `;

    /*
     * Cookie seguro.
     */
    setSessionCookie(
      res,
      sessionToken
    );

    /*
     * O frontend também recebe o token.
     *
     * Isso permite que chamadas como:
     *
     * Authorization: Bearer TOKEN
     *
     * funcionem com admin-me.js
     * e admin-dashboard.js.
     */
    return json(res, 200, {
      success: true,
      message: "Login realizado com sucesso.",
      token: sessionToken,
      admin: {
        id: Number(admin.id),
        email: admin.email,
        role: "admin",
        active: true
      },
      expires_at:
        expiresAt.toISOString()
    });
  } catch (error) {
    console.error(
      "USDTMZ ADMIN LOGIN ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error: "Erro interno no login."
    });
  }
}
