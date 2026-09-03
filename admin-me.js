// /api/admin-me.js
//
// USDTMZ — ADMIN ME
// Verifica o administrador autenticado através do Supabase Auth.
//
// IMPORTANTE:
// - Não contém senha.
// - Não contém chave privada.
// - Não contém SERVICE_ROLE_KEY.
// - O token de sessão vem do Authorization header.
// - O perfil é validado em public.admin_profiles.
//

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  // Apenas GET
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
    // 1. Obter token Supabase da sessão
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

    if (!user?.id || !user?.email) {
      return res.status(401).json({
        success: false,
        error: "INVALID_USER",
      });
    }

    // -----------------------------------------
    // 3. Consultar perfil administrativo
    // -----------------------------------------
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

    // -----------------------------------------
    // 4. Confirmar que é administrador ativo
    // -----------------------------------------
    if (!profile) {
      return res.status(403).json({
        success: false,
        error: "ADMIN_PROFILE_NOT_FOUND",
      });
    }

    if (profile.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "ADMIN_REQUIRED",
      });
    }

    if (profile.active !== true) {
      return res.status(403).json({
        success: false,
        error: "ADMIN_INACTIVE",
      });
    }

    // -----------------------------------------
    // 5. Resposta final
    // -----------------------------------------
    return res.status(200).json({
      success: true,
      authenticated: true,
      admin: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        active: profile.active,
        created_at: profile.created_at,
      },
    });
  } catch (error) {
    console.error("ADMIN_ME_ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}
