import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);

    const wallets = await sql`
      SELECT wallet_address
      FROM wallets
      WHERE network = 'TRON Mainnet'
        AND asset = 'USDT'
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;

    if (wallets.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Nenhuma carteira TRON Mainnet configurada."
      });
    }

    const address =
      String(
        wallets[0].wallet_address || ""
      ).trim();

    if (
      !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
    ) {
      return res.status(400).json({
        success: false,
        error: "O endereço TRON configurado é inválido."
      });
    }

    return res.status(200).json({

      success: true,

      wallet: {
        address,
        network: "TRON Mainnet",
        asset: "USDT",
        standard: "TRC-20",
        contract:
          "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
      }

    });

  } catch (error) {

    console.error(
      "USDTMZ WALLET ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Erro ao consultar a carteira."
    });

  }

}
