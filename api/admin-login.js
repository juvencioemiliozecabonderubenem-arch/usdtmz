import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const COOKIE_NAME = "usdtmz_admin_session";
const SESSION_HOURS = 12;

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
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

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function createScryptHash(password) {
  return new Promise((resolve, reject) => {
    const N = 16384;
    const r = 8;
    const p = 1;
    const salt = crypto.randomBytes(16);

    crypto.scrypt(
      password,
      salt,
      64,
      {
        N,
        r,
        p,
        maxmem: 32 * 1024 * 1024
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        const hash = [
          "scrypt",
          N,
          r,
          p,
          salt.toString("hex"),
          derivedKey.toString("hex")
        ].join("$");

        resolve(hash);
      }
    );
  });
}

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
    p <= 0 ||
    N > 1048576
  ) {
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

  if (!salt.length || !expectedKey.length) {
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

    if (
      !Buffer.isBuffer(derivedKey) ||
      derivedKey.length !== expectedKey.length
    ) {
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
        error: "Email ou senha incorretos."
      });
    }

    const admin = users[0];

    let storedHash = String(
      admin.password_hash || ""
    );

    /*
     * CONFIGURAÇÃO INICIAL
     *
     * Enquanto password_hash estiver como
     * "SEU_HASH", usamos temporariamente
     * ADMIN_PASSWORD para criar o hash.
     *
     * A senha digitada precisa ser igual à
     * ADMIN_PASSWORD configurada na Vercel.
     */
    if (
      !storedHash ||
      storedHash === "SEU_HASH"
    ) {
      const setupPassword =
        String(
          process.env.ADMIN_PASSWORD || ""
        );

      if (!setupPassword) {
        console.error(
          "ADMIN LOGIN: ADMIN_PASSWORD não configurada."
        );

        return json(res, 500, {
          success: false,
          error:
            "A senha administrativa ainda não foi configurada."
        });
      }

      if (password !== setupPassword) {
        return json(res, 401, {
          success: false,
          error: "Email ou senha incorretos."
        });
      }

      const newHash =
        await createScryptHash(
          setupPassword
        );

      const updated = await sql`
        UPDATE admin_users
        SET
          password_hash = ${newHash},
          updated_at = NOW()
        WHERE id = ${admin.id}
          AND active = true
          AND password_hash = 'SEU_HASH'
        RETURNING id, email
      `;

      if (updated.length === 0) {
        /*
         * Outro pedido pode ter configurado
         * o hash simultaneamente.
         */
