// /api/admin-me.js
//
// USDTMZ — ADMIN ME
// Verifica o utilizador autenticado no Supabase
// e confirma se ele é administrador ativo.

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
  // 3. TOKEN DE AUTENTICAÇÃO
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
    // 5. PROCURAR PERFIL ADMINISTRATIVO
    // -------------------------------------------------------
    const profileUrl =
      `${SUPABASE_URL}/rest/v1/admin_profiles` +
      `?select=id,email,role,active,created_at` +
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

    // -------------------------------------------------------
    // 6. VERIFICAR ROLE
    // -------------------------------------------------------
    if (profile.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Acesso administrativo não autorizado"
      });
    }

    // -------------------------------------------------------
    // 7. VERIFICAR SE O ADMIN ESTÁ ATIVO
    // -------------------------------------------------------
    if (profile.active !== true) {
      return res.status(403).json({
        success: false,
        error: "Conta administrativa desativada"
      });
    }

    // -------------------------------------------------------
    // 8. RESPOSTA
    // -------------------------------------------------------
    return res.status(200).json({
      success: true,
      admin: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        active: profile.active,
        created_at: profile.created_at
      }
    });

  } catch (error) {
    console.error("ADMIN-ME ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Erro interno do servidor"
    });
  }
}
