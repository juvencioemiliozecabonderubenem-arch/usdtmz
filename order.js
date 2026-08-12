import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

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
      payment,
      amount
    } = req.body || {};

    if (!name || !phone || !operation || !payment || amount === undefined) {
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

    const RATE = 64;

    const usdtAmount =
      operation === "buy"
        ? value / RATE
        : value;

    const orderId =
      "USDTMZ-" +
      Date.now().toString(36).toUpperCase();

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
        order_id,
        status,
        created_at
    `;

    return res.status(201).json({
      success: true,
      message: "Pedido USDTMZ criado e guardado.",
      order: {
        id: result[0].order_id,
        status: result[0].status,
        createdAt: result[0].created_at,
        operation,
        payment,
        amount: value,
        rate: RATE,
        usdtAmount: Number(usdtAmount.toFixed(2))
      }
    });

  } catch (error) {
    console.error("USDTMZ DATABASE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Não foi possível guardar o pedido."
    });
  }
}
