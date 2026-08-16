import { neon } from "@neondatabase/serverless";

const TRON_API = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

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

    const sql = neon(process.env.DATABASE_URL);

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
        error: "Nenhuma carteira Mainnet configurada."
      });
    }

    const address = wallets[0].wallet_address;

    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: "O endereço TRON configurado é inválido."
      });
    }

    /*
     * Consulta do saldo USDT TRC-20.
     */

    const response = await fetch(
      `${TRON_API}/v1/accounts/${address}/tokens`
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("TRON API ERROR:", data);

      return res.status(502).json({
        success: false,
        error: "Erro ao consultar a TRON Mainnet."
      });
    }

    let balance = "0.000000";

    const tokens = Array.isArray(data.data)
      ? data.data
      : [];

    const usdt = tokens.find(
      token =>
        String(token.token_id || "").toLowerCase() ===
        USDT_CONTRACT.toLowerCase()
    );

    if (usdt && usdt.balance !== undefined) {
      const raw = BigInt(String(usdt.balance));

      const whole = raw / 1000000n;

      const decimals = (raw % 1000000n)
        .toString()
        .padStart(6, "0");

      balance = `${whole}.${decimals}`;
    }

    return res.status(200).json({
      success: true,
      network: "TRON Mainnet",
      token: "USDT",
      standard: "TRC-20",
      contract: USDT_CONTRACT,
      address,
      balance
    });

  } catch (error) {
    console.error(
      "USDTMZ BLOCKCHAIN ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Erro interno ao consultar a blockchain."
    });
  }
}
