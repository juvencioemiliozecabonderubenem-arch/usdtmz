// /api/admin-me.js
//
// USDTMZ — ADMIN ME
//
// Verifica a sessão administrativa exclusivamente no NEON.
//
// FLUXO:
//
// Navegador
//   ↓
// Bearer session token
//   ↓
// SHA-256
//   ↓
// admin_sessions
//   ↓
// admin_users
//   ↓
// administrador ativo
//
// IMPORTANTE:
// - Supabase NÃO é utilizado.
// - Nenhum segredo fica neste arquivo.
// - DATABASE_URL deve estar nas Environment Variables da Vercel.
// - O token da sessão não é armazenado em texto puro.
//

import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";


/* =========================================================
 * RESPOSTA JSON
 * ========================================================= */

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}


/* =========================================================
 * HASH DA SESSÃO
 * ========================================================= */

function hashSessionToken(token) {
  return crypto
    .createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}


/* =========================================================
 * HANDLER
 * ========================================================= */

export default async function handler(req, res) {

  /* =======================================================
   * 1. MÉTODO
   * ======================================================= */

  if (req.method !== "GET") {

    res.setHeader(
      "Allow",
      "GET"
    );

    return json(res, 405, {
      success: false,
      error: "Método não permitido"
    });
  }


  /* =======================================================
   * 2. DATABASE
   * ======================================================= */

  const DATABASE_URL =
    process.env.DATABASE_URL;

  if (!DATABASE_URL) {

    console.error(
      "ADMIN-ME: DATABASE_URL não configurada."
    );

    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada"
    });
  }


  /* =======================================================
   * 3. TOKEN
   * ======================================================= */

  const authorization =
    req.headers.authorization || "";

  if (
    !authorization.startsWith("Bearer ")
  ) {

    return json(res, 401, {
      success: false,
      error: "Token de autenticação não fornecido"
    });
  }


  const sessionToken =
    authorization
      .substring(7)
      .trim();


  if (!sessionToken) {

    return json(res, 401, {
      success: false,
      error: "Token de autenticação inválido"
    });
  }


  /* =======================================================
   * 4. HASH
   * ======================================================= */

  const tokenHash =
    hashSessionToken(
      sessionToken
    );


  try {

    const sql =
      neon(DATABASE_URL);


    /* =====================================================
     * 5. VALIDAR SESSÃO + ADMIN
     * ===================================================== */

    const sessions =
      await sql`
        SELECT
          s.id AS session_id,
          s.user_id,
          s.expires_at,
          s.created_at AS session_created_at,
          u.email,
          u.active,
          u.created_at AS admin_created_at,
          u.updated_at AS admin_updated_at
        FROM admin_sessions s
        INNER JOIN admin_users u
          ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash}
          AND s.expires_at > NOW()
          AND u.active = true
        ORDER BY s.created_at DESC
        LIMIT 1
      `;


    /* =====================================================
     * 6. SESSÃO INVÁLIDA
     * ===================================================== */

    if (
      sessions.length === 0
    ) {

      return json(res, 401, {
        success: false,
        error: "Sessão administrativa inválida ou expirada"
      });
    }


    const admin =
      sessions[0];


    /* =====================================================
     * 7. RESPOSTA
     * ===================================================== */

    return json(res, 200, {

      success: true,

      admin: {

        id:
          Number(admin.user_id),

        email:
          admin.email,

        role:
          "admin",

        active:
          true,

        created_at:
          admin.admin_created_at
      }
    });


  } catch (error) {

    console.error(
      "USDTMZ ADMIN-ME ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {
      success: false,
      error: "Erro interno do servidor"
    });
  }
}
