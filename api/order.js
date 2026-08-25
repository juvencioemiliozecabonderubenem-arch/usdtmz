import { neon } from "@neondatabase/serverless";

const RATE = 50;

export default async function handler(req, res) {

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });

  }

  try {

    if (!process.env.DATABASE_URL) {

      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada no Vercel."
      });

    }

    const body = req.body || {};

    /*
     * Dados enviados pelo index.html
     */

    const phone =
      String(
        body.phone || ""
      ).trim();

    const payment =
      String(
        body.payment_method ||
        body.payment ||
        ""
      ).trim().toLowerCase();

    const operation =
      String(
        body.operation ||
        "buy"
      ).trim().toLowerCase();

    const name =
      String(
        body.name ||
        "Cliente"
      ).trim();

    const amountInput =
      body.amount_mzn ??
      body.amount ??
      body.amountMzn;

    /*
     * VALIDAÇÃO
     */

    if (!phone) {

      return res.status(400).json({
        success: false,
        error: "Informe o número de telefone."
      });

    }

    if (!["mpesa", "emola"].includes(payment)) {

      return res.status(400).json({
        success: false,
        error:
          "Escolha M-Pesa ou e-Mola."
      });

    }

    if (operation !== "buy") {

      return res.status(400).json({
        success: false,
        error: "Operação inválida."
      });

    }

    if (
      amountInput === undefined ||
      amountInput === null ||
      amountInput === ""
    ) {

      return res.status(400).json({
        success: false,
        error: "Informe o valor em MZN."
      });

    }

    const amount =
      Number(amountInput);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {

      return res.status(400).json({
        success: false,
        error: "Valor em MZN inválido."
      });

    }

    /*
     * CÁLCULO
     *
     * 50 MZN = 1 USDT
     */

    const usdtAmount =
      amount / RATE;

    /*
     * ID DO PEDIDO
     */

    const orderId =
      "USDTMZ-" +
      Date.now()
        .toString(36)
        .toUpperCase();

    const sql =
      neon(
        process.env.DATABASE_URL
      );

    /*
     * GUARDAR PEDIDO
     */

    const result =
      await sql`

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

    const order =
      result[0];

    /*
     * RESPOSTA
     */

    return res.status(201).json({

      success: true,

      message:
        "Pedido criado com sucesso.",

      order: {

        id:
          order.id,

        order_id:
          order.order_id,

        name:
          order.name,

        phone:
          order.phone,

        operation:
          order.operation,

        payment:
          order.payment,

        amount:
          order.amount,

        usdt_amount:
          Number(
            order.usdt_amount
          ).toFixed(6),

        rate:
          RATE,

        status:
          order.status,

        created_at:
          order.created_at

      }

    });

  } catch (error) {

    console.error(
      "USDTMZ ORDER ERROR:",
      error?.message ||
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Erro interno ao criar o pedido."

    });

  }

}
