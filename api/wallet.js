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

    const wallets = await sql`
      SELECT
        id,
        wallet_address,
        network,
        asset,
        status,
        created_at,
        updated_at
      FROM wallets
      ORDER BY id DESC
      LIMIT 1
    `;

    if (wallets.length === 0) {
      return res.status(200).json({
        success: true,
        wallet: null,
        message: "Nenhuma carteira configurada."
      });
    }

    const wallet = wallets[0];

    /*
     * A API não inventa saldo.
     *
     * O saldo verdadeiro será consultado
     * diretamente na blockchain através
     * de /api/blockchain.
     */

    return res.status(200).json({

      success: true,

      wallet: {

        id: wallet.id,

        address:
          wallet.wallet_address,

        network:
          "TRON Mainnet",

        asset:
          "USDT",

        status:
          "mainnet",

        created_at:
          wallet.created_at,

        updated_at:
          wallet.updated_at

      }

    });

  } catch (error) {

    console.error(
      "USDTMZ WALLET ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível consultar a carteira."
    });
  }
}
