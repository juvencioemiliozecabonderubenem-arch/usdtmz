uexport default async function handler(req, res) {
  // Apenas POST
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido."
    });
  }

  try {
    const {
      name,
      phone,
      operation,
      amount
    } = req.body || {};

    // Validação
    if (!name || !phone || !operation || !amount) {
      return res.status(400).json({
        success: false,
        message: "Preencha todos os campos obrigatórios."
      });
    }

    if (!["buy", "sell"].includes(operation)) {
      return res.status(400).json({
        success: false,
        message: "Operação inválida."
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valor inválido."
      });
    }

    // ID único do pedido
    const orderId =
      "USDTMZ-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    // Pedido criado.
    // A gravação no banco será adicionada no próximo passo.
    const order = {
      orderId,
      name: name.trim(),
      phone: phone.trim(),
      operation,
      amount: numericAmount,
      status: "PENDING",
      createdAt: new Date().toISOString()
    };

    return res.status(201).json({
      success: true,
      message: "Pedido criado com sucesso.",
      order
    });

  } catch (error) {
    console.error("USDTMZ order error:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}
