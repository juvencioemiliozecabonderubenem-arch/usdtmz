// /api/admin-dashboard.js
//
// USDTMZ — ADMIN DASHBOARD
//
// Painel administrativo usando exclusivamente NEON.
//
// FLUXO:
//
// Admin
//   ↓
// Bearer session token
//   ↓
// admin_sessions
//   ↓
// admin_users
//   ↓
// Estatísticas do sistema
//   ↓
// Neon
//
// IMPORTANTE:
// - Supabase NÃO é utilizado.
// - Nenhum segredo fica no código.
// - DATABASE_URL deve existir nas Environment Variables da Vercel.
// - O token da sessão nunca é armazenado em texto puro.
// - A sessão é validada através do hash SHA-256.
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
 * HASH DO TOKEN DA SESSÃO
 *
 * A sessão armazenada no banco utiliza token_hash.
 * O token recebido pelo navegador é transformado em
 * SHA-256 antes da consulta.
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
      "ADMIN-DASHBOARD: DATABASE_URL não configurada."
    );

    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada"
    });
  }


  /* =======================================================
   * 3. AUTHORIZATION HEADER
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
   * 4. HASH DA SESSÃO
   * ======================================================= */

  const tokenHash =
    hashSessionToken(
      sessionToken
    );


  try {

    const sql =
      neon(DATABASE_URL);


    /* =====================================================
     * 5. VALIDAR SESSÃO ADMINISTRATIVA
     *
     * A sessão precisa:
     *
     * - existir;
     * - não estar expirada;
     * - estar ligada a um admin_user;
     * - estar ativa.
     * ===================================================== */

    const sessions =
      await sql`
        SELECT
          s.id AS session_id,
          s.user_id,
          s.expires_at,
          u.email,
          u.active
        FROM admin_sessions s
        INNER JOIN admin_users u
          ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash}
          AND s.expires_at > NOW()
          AND u.active = true
        ORDER BY s.created_at DESC
        LIMIT 1
      `;


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
     * 6. ESTATÍSTICAS — ORDERS
     * ===================================================== */

    const orderStats =
      await sql`
        SELECT
          COUNT(*) AS total_orders,

          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(status, '')) = 'PENDING'
          ) AS pending_orders,

          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(status, '')) = 'PAYMENT_CONFIRMED'
          ) AS confirmed_payments

        FROM orders
      `;


    /* =====================================================
     * 7. ESTATÍSTICAS — WITHDRAWALS
     * ===================================================== */

    const withdrawalStats =
      await sql`
        SELECT

          COUNT(*) AS total_withdrawals,

          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(status, ''))
            IN (
              'PENDING',
              'AUTHORIZED',
              'PROCESSING'
            )
          ) AS pending_withdrawals

        FROM withdrawals
      `;


    /* =====================================================
     * 8. ESTATÍSTICAS — TRANSACTIONS
     * ===================================================== */

    const transactionStats =
      await sql`
        SELECT
          COUNT(*) AS total_transactions
        FROM transactions
      `;


    /* =====================================================
     * 9. SALDO DA CARTEIRA USDT
     *
     * Somente carteira USDT.
     * ===================================================== */

    const walletStats =
      await sql`
        SELECT
          COALESCE(
            SUM(balance),
            0
          ) AS wallet_usdt_balance

        FROM wallets

        WHERE UPPER(
          COALESCE(asset, '')
        ) = 'USDT'
      `;


    /* =====================================================
     * 10. NORMALIZAR RESULTADOS
     * ===================================================== */

    const orders =
      orderStats[0] || {};

    const withdrawals =
      withdrawalStats[0] || {};

    const transactions =
      transactionStats[0] || {};

    const wallet =
      walletStats[0] || {};


    /* =====================================================
     * 11. RESPOSTA
     * ===================================================== */

    return json(res, 200, {

      success: true,

      admin: {
        id: Number(admin.user_id),
        email: admin.email,
        active: true
      },

      stats: {

        total_orders:
          Number(
            orders.total_orders || 0
          ),

        pending_orders:
          Number(
            orders.pending_orders || 0
          ),

        confirmed_payments:
          Number(
            orders.confirmed_payments || 0
          ),

        total_withdrawals:
          Number(
            withdrawals.total_withdrawals || 0
          ),

        pending_withdrawals:
          Number(
            withdrawals.pending_withdrawals || 0
          ),

        total_transactions:
          Number(
            transactions.total_transactions || 0
          ),

        wallet_usdt_balance:
          Number(
            wallet.wallet_usdt_balance || 0
          )
      }
    });


  } catch (error) {

    console.error(
      "USDTMZ ADMIN-DASHBOARD ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {
      success: false,
      error: "Erro interno ao carregar o painel administrativo"
    });
  }
}
