export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método não permitido. Use POST."
    });
  }

  const apiKey = process.env.MPESA_API_KEY_TEST;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "MPESA_API_KEY_TEST não configurada na Vercel."
    });
  }

  /*
   * IMPORTANTE:
   * O endpoint e os nomes exatos dos campos abaixo
   * devem ser os fornecidos pelo portal M-Pesa da tua conta.
   * Não vamos inventá-los.
   */

  return res.status(200).json({
    ok: true,
    environment: "testing",
    mpesaConfigured: true,
    message: "Credencial M-Pesa Testing encontrada. Endpoint C2B aguardando configuração oficial."
  });
}
