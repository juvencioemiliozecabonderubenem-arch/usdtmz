// /api/admin-dashboard.js
//
// USDTMZ — ADMIN DASHBOARD
// Retorna os dados principais do painel administrativo
// depois de verificar a sessão e o perfil de administrador.

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. MÉTODO
  // ---------------------------------------------------------
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  // ---------------------------------------------------------
  // 2. CONFIGURAÇÃO SUPABASE
  // ---------------------------------------------------------
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      success: false,
      error: "Supabase não configurado no servidor"
    });
  }

  // ---------------------------------------------------------
  // 3. TOKEN
  // ---------------------------------------------------------
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Token de autenticação não fornecido"
    });
  }

  const accessToken = authorization.substring(7).trim();

  if (!accessToken) {
    return res.status(401).json({
      success: false,
      error: "Token de autenticação inválido"
    });
  }

  try {
    // -------------------------------------------------------
    // 4. VERIFICAR UTILIZADOR NO SUPABASE AUTH
    // -------------------------------------------------------
    const userResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(401).json({
        success: false,
        error: "Sessão inválida ou expirada"
      });
    }

    const user = await userResponse.json();

    if (!user || !user.id) {
      return res.status(401).json({
        success: false,
        error: "Utilizador não autenticado"
      });
    }

    // -------------------------------------------------------
    // 5. VERIFICAR PERFIL ADMINISTRATIVO
    // -------------------------------------------------------
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
        Accept: "application/json"
      }
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();

      console.error(
        "Erro ao consultar admin_profiles:",
        errorText
      );

      return res.status(500).json({
        success: false,
        error: "Não foi possível verificar o perfil administrativo"
      });
    }

    const profiles = await profileResponse.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(403).json({
        success: false,
        error: "Utilizador não é administrador"
      });
    }

    const profile = profiles[0];

    if (profile.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Acesso administrativo não autorizado"
      });
    }

    if (profile.active !== true) {
      return res.status(403).json({
        success: false,
        error: "Conta administrativa desativada"
      });
    }

    // -------------------------------------------------------
    // 6. BUSCAR ESTATÍSTICAS DO PAINEL
    // -------------------------------------------------------
    const statsUrl =
      `${SUPABASE_URL}/rest/v1/admin_dashboard_stats?select=*`;

    const statsResponse = await fetch(statsUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (!statsResponse.ok) {
      const errorText = await statsResponse.text();

      console.error(
        "Erro ao consultar admin_dashboard_stats:",
        errorText
      );

      return res.status(500).json({
        success: false,
        error: "Não foi possível carregar as estatísticas"
      });
    }

    const statsData = await statsResponse.json();

    if (!Array.isArray(statsData) || statsData.length === 0) {
      return res.status(200).json({
        success: true,
        stats: {
          total_orders: 0,
          pending_orders: 0,
          confirmed_payments: 0,
          total_withdrawals: 0,
          pending_withdrawals: 0,
          total_transactions: 0,
          wallet_usdt_balance: 0
        }
      });
    }

    const stats = statsData[0];

    // -------------------------------------------------------
    // 7. RESPOSTA
    // -------------------------------------------------------
    return res.status(200).json({
      success: true,
      stats: {
        total_orders: Number(stats.total_orders || 0),
        pending_orders: Number(stats.pending_orders || 0),
        confirmed_payments: Number(stats.confirmed_payments || 0),
        total_withdrawals: Number(stats.total_withdrawals || 0),
        pending_withdrawals: Number(stats.pending_withdrawals || 0),
        total_transactions: Number(stats.total_transactions || 0),
        wallet_usdt_balance: Number(stats.wallet_usdt_balance || 0)
      }
    });

  } catch (error) {
    console.error("ADMIN-DASHBOARD ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Erro interno do servidor"
    });
  }
}
