import { neon } from "@neondatabase/serverless";

const RATE = 64;

function json(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  return res.json(data);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Método não permitido."
    });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return json(res, 500, {
        success: false,
        message: "DATABASE_URL não configurada no Vercel."
      });
    }

    const body = req.body || {};

    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const operation = String(body.operation || "").trim();
    const payment = String(body.payment || "").trim();
    const amount = Number(body.amount);

    if (!name || !phone || !operation || !payment) {
      return json(res, 400, {
        success: false,
        message: "Preencha todos os campos."
      });
    }

    if (!["buy", "sell"].includes(operation)) {
      return json(res, 400, {
        success: false,
        message: "Operação inválida."
      });
    }

    if (!["mpesa", "emola"].includes(payment)) {
      return json(res, 400, {
        success: false,
        message: "Método de pagamento inválido."
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return json(res, 400, {
        success: false,
        message: "Valor inválido."
      });
    }

    const usdtAmount =
      operation === "buy"
        ? amount / RATE
        : amount;

    const orderId =
      "USDTMZ-" +
      Date.now().toString(36).toUpperCase();

    const sql = neon(databaseUrl);

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
        ${amount},
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

    const order = result[0];

    return json(res, 201, {
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

    console.error("USDTMZ BACKEND ERROR:", error);

    return json(res, 500, {
      success: false,
      message: "Erro interno do backend.",
      error: error.message
    });
  }
}
