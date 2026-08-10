export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido."
    });
  }

  try {
    const {
      address,
      amount
    } = req.body || {};

    if (!address || !amount) {
      return res.status(400).json({
        success: false,
        message: "Endereço e quantidade são obrigatórios."
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantidade inválida."
      });
    }

    // Validação básica de endereço TRON
    if (!/^T[a-zA-Z0-9]{33}$/.test(address)) {
      return res.status(400).json({
        success: false,
        message: "Endereço TRC20 inválido."
      });
    }

    const withdrawalId =
      "TEST-WD-" +
      Date.now().toString(36).toUpperCase();

    return res.status(200).json({
      success: true,
      testMode: true,
      withdrawalId,
      network: "TRON-TRC20",
      amount: numericAmount,
      destination: address,
      status: "PENDING",
      message:
        "Pedido de envio criado em modo de teste. Nenhum USDT foi movimentado."
    });

  } catch (error) {
    console.error("Binance test error:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}
