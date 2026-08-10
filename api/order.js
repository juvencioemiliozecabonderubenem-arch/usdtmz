export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido"
    });
  }

  const { name, phone, operation, amount, payment } = req.body || {};

  if (!name || !phone || !operation || !amount || !payment) {
    return res.status(400).json({
      success: false,
      message: "Preencha todos os campos."
    });
  }

  const orderId = "USDTMZ-" + Date.now().toString().slice(-6);

  return res.status(200).json({
    success: true,
    orderId,
    message: "Pedido recebido com sucesso.",
    status: "PENDING"
  });
}
