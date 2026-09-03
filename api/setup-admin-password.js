import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const SETUP_SECRET = process.env.ADMIN_SETUP_SECRET;

function json(res, status, data) {
  return res.status(status).json(data);
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada."
    });
  }

  /*
   * Proteção adicional.
   *
   * Não execute este endpoint sem
   * ADMIN_SETUP_SECRET configurado.
   */
  if (!SETUP_SECRET) {
    return json(res, 403, {
      success: false,
      error: "Configuração temporária não autorizada."
    });
  }

  const suppliedSecret =
    req.headers["x-admin-setup-secret"];

  if (
    typeof suppliedSecret !== "string" ||
    suppliedSecret !== SETUP_SECRET
  ) {
    return json(res, 403, {
      success: false,
      error: "Não autorizado."
    });
  }

  try {
    const password =
      String(process.env.ADMIN_PASSWORD || "");

    if (!password) {
      return json(res, 500, {
        success: false,
        error: "ADMIN_PASSWORD não configurada."
      });
    }

    const hash =
      await createScryptHash(password);

    const sql =
      neon(process.env.DATABASE_URL);

    const result = await sql`
      UPDATE admin_users
      SET
        password_hash = ${hash},
        updated_at = NOW()
      WHERE id = 1
        AND active = true
      RETURNING id
    `;

    if (result.length === 0) {
      return json(res, 404, {
        success: false,
        error:
          "Administrador ativo não encontrado."
      });
    }

    return json(res, 200, {
      success: true,
      message:
        "Password hash configurado com sucesso."
    });
  } catch (error) {
    console.error(
      "SETUP ADMIN PASSWORD ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao configurar a senha."
    });
  }
}
