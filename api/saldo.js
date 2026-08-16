import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  // Permitir apenas GET
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  try {
    // Verificar conexão com o Neon
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada"
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    // Criar o registro do proprietário caso ainda não exista
    await sql`
      INSERT INTO balances (
        user_id,
        usdt_balance
      )
      VALUES (
        'owner',
        0
      )
      ON CONFLICT (user_id)
      DO NOTHING
    `;

    // Consultar saldo
    const result = await sql`
      SELECT
        user_id,
        usdt_balance,
        updated_at
      FROM balances
      WHERE user_id = 'owner'
      LIMIT 1
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Saldo não encontrado"
      });
    }

    const balance = result[0];

    return res.status(200).json({
      success: true,
      wallet: {
        user_id: balance.user_id,
        asset: "USDT",
        balance: Number(balance.usdt_balance).toFixed(6),
        updated_at: balance.updated_at
      }
    });

  } catch (error) {
    console.error("USDTMZ SALDO ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Erro interno ao consultar o saldo"
    });
  }
}
