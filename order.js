export default async function handler(req, res) {

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

    if (!name || !phone || !operation || !amount) {
      return res.status(400).json({
        success: false,
        message: "Preencha todos os campos."
      });
    }

    if (!["buy", "sell"].includes(operation)) {
      return res.status(400).json({
        success: false,
        message: "Operação inválida."
      });
    }

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valor inválido."
      });
    }

    const orderId =
      "USDTMZ-" +
      Date.now().toString(36).toUpperCase();

    return res.status(201).json({
      success: true,
      orderId: orderId,
      status: "PENDING",
      message: "Pedido recebido com sucesso."
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}
