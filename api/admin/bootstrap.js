import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto.scryptSync(
    password,
    salt,
    64
  ).toString("hex");

  return `${salt}:${hash}`;
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

    if (!process.env.ADMIN_BOOTSTRAP_SECRET) {
      return json(res, 500, {
        success: false,
        error: "ADMIN_BOOTSTRAP_SECRET não configurada."
      });
    }

    const body = req.body || {};

    const secret =
      String(body.secret || "").trim();

    const email =
      String(body.email || "")
        .trim()
        .toLowerCase();

    const password =
      String(body.password || "");

    if (
      secret !==
      process.env.ADMIN_BOOTSTRAP_SECRET
    ) {
      return json(res, 401, {
        success: false,
        error: "Autorização inválida."
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email)
    ) {
      return json(res, 400, {
        success: false,
        error: "Email inválido."
      });
    }

    if (password.length < 10) {
      return json(res, 400, {
        success: false,
        error:
          "A senha deve ter pelo menos 10 caracteres."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);

    const existing =
      await sql`
        SELECT id
        FROM admin_users
        WHERE email = ${email}
        LIMIT 1
      `;

    if (existing.length) {
      return json(res, 409, {
        success: false,
        error: "Administrador já existe."
      });
    }

    const passwordHash =
      hashPassword(password);

    await sql`
      INSERT INTO admin_users (
        email,
        password_hash,
        active
      )
      VALUES (
        ${email},
        ${passwordHash},
        TRUE
      )
    `;

    return json(res, 201, {
      success: true,
      message:
        "Administrador criado com sucesso."
    });

  } catch (error) {

    console.error(
      "ADMIN BOOTSTRAP ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao criar administrador."
    });
  }
}
