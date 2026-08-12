import { neon } from "@neondatabase/serverless";

const RATE = 64;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido."
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        message: "DATABASE_URL não está configurada no Vercel."
      });
    }

    const {
      name,
      phone,
      operation,
      payment,
      amount
    } = req.body || {};

    if (!name || !phone || !operation || !payment || !amount) {
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

    if (!["mpesa", "emola"].includes(payment)) {
      return res.status(400).json({
        success: false,
        message: "Método de pagamento inválido."
      });
    }

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valor inválido."
      });
    }

    const usdtAmount =
      operation === "buy"
        ? value / RATE
        : value;

    const orderId =
      "USDTMZ-" +
      Date.now().toString(36).toUpperCase();

    const sql = neon(process.env.DATABASE_URL);

    const result = await sql`
      INSERT INTO orders (
        order_id,
        name,
        phone,
        operation,
        payment,
        amount,
        usdt_amount,
        rate,
        status
      )
      VALUES (
        ${orderId},
        ${name},
        ${phone},
        ${operation},
        ${payment},
        ${value},
        ${usdtAmount},
        ${RATE},
        'PENDING'
      )
      RETURNING
        id,
        order_id,
        name,
        phone,
        operation,
        payment,
        amount,
        usdt_amount,
        rate,
        status,
        created_at
    `;

    const order = result[0];

    return res.status(201).json({
      success: true,
      message: "Pedido criado com sucesso.",
      order: {
        id: order.order_id,
        databaseId: order.id,
        operation: order.operation,
        payment: order.payment,
        amount: Number(order.amount),
        usdtAmount: Number(order.usdt_amount),
        rate: Number(order.rate),
        status: order.status,
        createdAt: order.created_at
      }
    });

  } catch (error) {

    console.error("USDTMZ ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Erro ao criar pedido no servidor.",
      error: error.message
    });
  }
}
