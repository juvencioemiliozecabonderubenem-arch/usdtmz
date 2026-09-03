// /api/supabase-config.js
//
// USDTMZ — SUPABASE CONFIG
// Fornece ao navegador apenas as informações públicas
// necessárias para inicializar o Supabase.
//
// IMPORTANTE:
// Nunca coloque aqui SUPABASE_SERVICE_ROLE_KEY,
// TRON_PRIVATE_KEY ou qualquer outro segredo.

export default function handler(req, res) {
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
  // 2. CONFIGURAÇÃO
  // ---------------------------------------------------------
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // ---------------------------------------------------------
  // 3. VERIFICAR CONFIGURAÇÃO
  // ---------------------------------------------------------
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      success: false,
      error: "Configuração pública do Supabase não encontrada"
    });
  }

  // ---------------------------------------------------------
  // 4. RESPOSTA
  // ---------------------------------------------------------
  return res.status(200).json({
    success: true,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY
  });
}
