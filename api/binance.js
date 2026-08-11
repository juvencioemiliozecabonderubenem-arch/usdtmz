export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Use POST"
    });
  }

  const address = process.env.BINANCE_USDT_TRC20_ADDRESS;

  if (!address) {
    return res.status(500).json({
      success: false,
      message: "Endereço Binance não configurado no Vercel"
    });
  }

  const { amount } = req.body || {};

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Quantidade inválida"
    });
  }

  return res.status(200).json({
    success: true,
    asset: "USDT",
    network: "TRC20",
    destination: address,
    amount: Number(amount),
    status: "READY",
    message: "Destino Binance configurado. Nenhum USDT foi enviado."
  });
}
