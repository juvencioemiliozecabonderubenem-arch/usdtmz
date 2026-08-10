
import sql from "./db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido."
    });
  }

  try {
    const { name, phone, operation, amount } = req.body || {};

    if (!name || !phone || !operation || amount === undefined) {
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

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valor inválido."
      });
    }

    const orderId =
      "USDTMZ-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    const result = await sql`
      INSERT INTO orders (
        order_id,
        name,
        phone,
        operation,
        amount,
        status
      )
      VALUES (
        ${orderId},
        ${name.trim()},
        ${phone.trim()},
        ${operation},
        ${numericAmount},
        'PENDING'
      )
      RETURNING
        order_id,
        name,
        phone,
        operation,
        amount,
        status,
        created_at
    `;

    return res.status(201).json({
      success: true,
      message: "Pedido guardado com sucesso.",
      order: result[0]
    });

  } catch (error) {
    console.error("USDTMZ order error:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}
