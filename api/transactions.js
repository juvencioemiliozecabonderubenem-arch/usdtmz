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

    const transactions = await sql`
      SELECT
        wt.id,
        wt.order_id,
        wt.tx_hash,
        wt.type,
        wt.asset,
        wt.amount,
        wt.network,
        wt.status,
        wt.created_at,

        w.wallet_address

      FROM wallet_transactions wt

      LEFT JOIN wallets w
        ON w.id = wt.wallet_id

      ORDER BY wt.created_at DESC

      LIMIT 100
    `;

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions
    });

  } catch (error) {

    console.error(
      "USDTMZ TRANSACTIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Não foi possível carregar as transações."
    });
  }
}
