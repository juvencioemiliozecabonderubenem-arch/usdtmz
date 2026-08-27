import { neon } from "@neondatabase/serverless";
import {
  scryptSync,
  timingSafeEqual,
  createHmac
} from "node:crypto";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function verifyPassword(password, storedHash) {
  try {
    const [saltHex, hashHex] =
      String(storedHash || "").split(":");

    if (!saltHex || !hashHex) {
      return false;
    }

    const salt =
      Buffer.from(saltHex, "hex");

    const stored =
      Buffer.from(hashHex, "hex");

    const derived =
      scryptSync(
        password,
        salt,
        stored.length
      );

    return (
      derived.length === stored.length &&
      timingSafeEqual(
        derived,
        stored
      )
    );

  } catch {
    return false;
  }
}

function createSession(user) {

  const payload = {
    id: user.id,
    email: user.email,
    exp:
      Date.now() +
      8 * 60 * 60 * 1000
  };

  const encoded =
    Buffer.from(
      JSON.stringify(payload)
    ).toString("base64url");

  const signature =
    createHmac(
      "sha256",
      process.env.ADMIN_SESSION_SECRET
    )
      .update(encoded)
      .digest("base64url");

  return `${encoded}.${signature}`;
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
      error:
        "DATABASE_URL não configurada."
    });

  }

  if (!process.env.ADMIN_SESSION_SECRET) {

    return json(res, 500, {
      success: false,
      error:
        "ADMIN_SESSION_SECRET não configurada."
    });

  }

  try {

    const sql =
      neon(
        process.env.DATABASE_URL
      );

    const email =
      String(
        req.body?.email || ""
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        req.body?.password || ""
      );

    if (!email || !password) {

      return json(res, 400, {
        success: false,
        error:
          "E-mail e senha são obrigatórios."
      });

    }

    if (
      email.length > 200 ||
      password.length > 200
    ) {

      return json(res, 400, {
        success: false,
        error: "Dados inválidos."
      });

    }

    const users =
      await sql`

        SELECT
          id,
          email,
          password_hash,
          active

        FROM admin_users

        WHERE LOWER(email) =
          ${email}

        LIMIT 1

      `;

    if (users.length === 0) {

      return json(res, 401, {
        success: false,
        error:
          "E-mail ou senha inválidos."
      });

    }

    const user =
      users[0];

    if (!user.active) {

      return json(res, 403, {
        success: false,
        error:
          "Acesso administrativo desativado."
      });

    }

    const validPassword =
      verifyPassword(
        password,
        user.password_hash
      );

    if (!validPassword) {

      return json(res, 401, {
        success: false,
        error:
          "E-mail ou senha inválidos."
      });

    }

    const session =
      createSession(user);

    res.setHeader(
      "Set-Cookie",
      [
        `usdtmz_admin_session=${session}`,
        "HttpOnly",
        "Path=/",
        "SameSite=Strict",
        "Secure",
        "Max-Age=28800"
      ].join("; ")
    );

    return json(res, 200, {

      success: true,

      message:
        "Login realizado com sucesso.",

      admin: {
        id: user.id,
        email: user.email
      }

    });

  } catch (error) {

    console.error(
      "ADMIN LOGIN ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao processar o login."
    });

  }

}
