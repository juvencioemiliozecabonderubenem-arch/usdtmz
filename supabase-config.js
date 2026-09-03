// /api/supabase-config.js
//
// USDTMZ — SUPABASE PUBLIC CONFIG
//
// Esta API disponibiliza somente:
// - SUPABASE_URL
// - chave pública do Supabase
//
// NÃO disponibiliza:
// - SUPABASE_SECRET_KEY
// - SERVICE_ROLE_KEY
// - TRON_PRIVATE_KEY
// - DATABASE_URL
// - qualquer segredo do servidor
//

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL;

  const supabaseKey =
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: "SUPABASE_CONFIG_NOT_FOUND",
    });
  }

  return res.status(200).json({
    success: true,

    supabase: {
      url: supabaseUrl,
      anonKey: supabaseKey,
    },
  });
}
