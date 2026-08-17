import { neon } from "@neondatabase/serverless";

const USDT_CONTRACT =
  "TR7NHqjeKQ8GZJ6YxZ9k2w3s4v5u6t7r8";

export default async function handler(req, res) {
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
        error: "DATABASE_URL não configurada."
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    const {
      withdrawal_id
    } = req.body || {};

    const withdrawalId =
      String(withdrawal_id || "").trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Informe o withdrawal_id."
      });
    }

    const result = await sql`
      SELECT
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status
      FROM withdrawals
      WHERE withdrawal_id = ${withdrawalId}
      LIMIT 1
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Retirada não encontrada."
      });
    }

    const withdrawal = result[0];

    if (withdrawal.status !== "AUTHORIZED") {
      return res.status(409).json({
        success: false,
        error:
          "A retirada precisa estar AUTHORIZED."
      });
    }

    if (withdrawal.asset !== "USDT") {
      return res.status(400).json({
        success: false,
        error: "Ativo inválido."
      });
    }

    if (withdrawal.network !== "TRON Mainnet") {
      return res.status(400).json({
        success: false,
        error: "Rede inválida."
      });
    }

    const amountNumber =
      Number(withdrawal.amount);

    if (
      !Number.isFinite(amountNumber) ||
      amountNumber <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Valor USDT inválido."
      });
    }

    return res.status(200).json({
      success: true,
      status: "UNSIGNED",
      message:
        "Retirada autorizada. Pronta para construção da transação TRC-20.",
      transaction: {
        withdrawal_id:
          withdrawal.withdrawal_id,

        contract:
          USDT_CONTRACT,

        network:
          "TRON Mainnet",

        destination_address:
          withdrawal.destination_address,

        amount:
          amountNumber,

        decimals: 6,

        signed: false,

        broadcasted: false
      }
    });

  } catch (error) {

    console.error(
      "USDTMZ CREATE TRANSACTION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível preparar a transação."
    });
  }
}
