import { neon } from "@neondatabase/serverless";

const RATE = 64;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL não configurada no Vercel");
    }

    const { name, phone, operation, payment, amount } = req.body || {};

    if (!name || !phone || !operation || !payment || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: "Preencha todos os campos"
      });
    }

    if (!["buy", "sell"].includes(operation)) {
      return res.status(400).json({
        success: false,
        error: "Operação inválida"
      });
    }

    if (!["mpesa", "emola"].includes(payment)) {
      return res.status(400).json({
        success: false,
        error: "Método de pagamento inválido"
      });
    }

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valor inválido"
      });
    }

    const usdtAmount = operation === "buy"
      ? value / RATE
      : value;

    const orderId =
      "USDTMZ-" + Date.now().toString(36).toUpperCase();

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
        operation,
        payment,
        amount,
        usdt_amount,
        rate,
        status,
        created_at
    `;

    return res.status(201).json({
      success: true,
      message: "Pedido criado com sucesso",
      order: result[0]
    });

  } catch (error) {
    console.error("USDTMZ ORDER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || String(error)
    });
  }
}
