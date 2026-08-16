import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada"
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    const orderId = String(
      req.query.order_id || ""
    ).trim();

    /*
     * Se for informado um pedido,
     * retorna somente esse pedido.
     */

    if (orderId) {
      const pedidos = await sql`
        SELECT
          order_id,
          name,
          phone,
          operation,
          payment,
          amount,
          usdt_amount,
          rate,
          status,
          mpesa_transaction_id,
          blockchain_tx_hash,
          wallet_address,
          created_at,
          updated_at
        FROM orders
        WHERE order_id = ${orderId}
        LIMIT 1
      `;

      if (pedidos.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Pedido não encontrado."
        });
      }

      return res.status(200).json({
        success: true,
        pedido: pedidos[0]
      });
    }

    /*
     * Sem order_id:
     * lista os últimos 50 pedidos.
     */

    const pedidos = await sql`
      SELECT
        order_id,
        name,
        phone,
        operation,
        payment,
        amount,
        usdt_amount,
        rate,
        status,
        mpesa_transaction_id,
        blockchain_tx_hash,
        wallet_address,
        created_at,
        updated_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return res.status(200).json({
      success: true,
      pedidos
    });

  } catch (error) {
    console.error(
      "USDTMZ PEDIDOS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Não foi possível carregar os pedidos."
    });
  }
}
