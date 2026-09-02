import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

function json(res, status, data) {
  return res.status(status).json(data);
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
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return json(res, 400, {
        success: false,
        error: "Email é obrigatório.",
      });
    }

    const users = await sql`
      SELECT
        id,
        email,
        active
      FROM admin_users
      WHERE LOWER(email) = ${email}
        AND active = true
      LIMIT 1
    `;

    if (users.length === 0) {
      return json(res, 401, {
        success: false,
        error: "Administrador não encontrado.",
      });
    }

    return json(res, 200, {
      success: true,
      message: "Administrador encontrado.",
      admin: {
        id: users[0].id,
        email: users[0].email,
        active: users[0].active,
      },
    });
  } catch (error) {
    console.error("ADMIN LOGIN ERROR:", error);

    return json(res, 500, {
      success: false,
      error: "Erro interno.",
    });
  }
}
