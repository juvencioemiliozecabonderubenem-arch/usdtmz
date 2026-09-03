// /api/admin-dashboard.js
//
// USDTMZ — ADMIN DASHBOARD
// Retorna estatísticas do painel administrativo.
//
// Acesso:
// GET /api/admin-dashboard
//
// Autenticação:
// Supabase Auth Bearer Token
//

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      success: false,
      error: "SUPABASE_NOT_CONFIGURED",
    });
  }

  try {
    // -----------------------------------------
    // 1. Verificar sessão
    // -----------------------------------------

    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
      });
    }

    const accessToken = authorization.substring(7).trim();

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
      });
    }

    // -----------------------------------------
    // 2. Confirmar usuário no Supabase Auth
    // -----------------------------------------

    const userResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!userResponse.ok) {
      return res.status(401).json({
        success: false,
        error: "INVALID_SESSION",
      });
    }

    const user = await userResponse.json();

    if (!user?.id) {
      return res.status(401).json({
        success: false,
        error: "INVALID_USER",
      });
    }

    // -----------------------------------------
    // 3. Verificar perfil administrativo
    // -----------------------------------------

    const profileUrl =
      `${SUPABASE_URL}/rest/v1/admin_profiles` +
      `?select=id,email,role,active` +
      `&id=eq.${encodeURIComponent(user.id)}` +
      `&limit=1`;

    const profileResponse = await fetch(profileUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!profileResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "PROFILE_LOOKUP_FAILED",
      });
    }

    const profiles = await profileResponse.json();
    const profile = profiles?.[0];

    if (!profile) {
      return res.status(403).json({
        success: false,
        error: "ADMIN_PROFILE_NOT_FOUND",
      });
    }

    if (profile.role !== "admin" || profile.active !== true) {
      return res.status(403).json({
        success: false,
        error: "ADMIN_ACCESS_DENIED",
      });
    }

    // -----------------------------------------
    // 4. Buscar estatísticas
    // -----------------------------------------

    const statsUrl =
      `${SUPABASE_URL}/rest/v1/admin_dashboard_stats` +
      `?select=*`;

    const statsResponse = await fetch(statsUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!statsResponse.ok) {
      const errorText = await statsResponse.text();

      console.error(
        "ADMIN_DASHBOARD_STATS_ERROR:",
        errorText
      );

      return res.status(500).json({
        success: false,
        error: "STATS_LOOKUP_FAILED",
      });
    }

    const statsRows = await statsResponse.json();
    const stats = statsRows?.[0];

    if (!stats) {
      return res.status(200).json({
        success: true,
        dashboard: {
          total_orders: 0,
          pending_orders: 0,
          confirmed_payments: 0,
          total_withdrawals: 0,
          pending_withdrawals: 0,
          total_transactions: 0,
          wallet_usdt_balance: 0,
        },
      });
    }

    // -----------------------------------------
    // 5. Resposta
    // -----------------------------------------

    return res.status(200).json({
      success: true,

      dashboard: {
        total_orders: Number(stats.total_orders || 0),
        pending_orders: Number(stats.pending_orders || 0),
        confirmed_payments: Number(
          stats.confirmed_payments || 0
        ),
        total_withdrawals: Number(
          stats.total_withdrawals || 0
        ),
        pending_withdrawals: Number(
          stats.pending_withdrawals || 0
        ),
        total_transactions: Number(
          stats.total_transactions || 0
        ),
        wallet_usdt_balance: Number(
          stats.wallet_usdt_balance || 0
        ),
      },
    });
  } catch (error) {
    console.error("ADMIN_DASHBOARD_ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}
