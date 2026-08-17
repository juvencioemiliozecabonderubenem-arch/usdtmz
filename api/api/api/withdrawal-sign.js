import { neon } from "@neondatabase/serverless";

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
      withdrawal_id,
      unsigned_transaction
    } = req.body || {};

    const withdrawalId =
      String(withdrawal_id || "").trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Informe o withdrawal_id."
      });
    }

    if (!unsigned_transaction) {
      return res.status(400).json({
        success: false,
        error: "Transação não assinada não informada."
      });
    }

    const result = await sql`
      SELECT
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

    return res.status(200).json({
      success: true,
      status: "READY_FOR_SECURE_SIGNING",
      message:
        "Transação validada e pronta para o assinador seguro.",
      withdrawal: {
        withdrawal_id:
          withdrawal.withdrawal_id,

        destination_address:
          withdrawal.destination_address,

        asset:
          withdrawal.asset,

        network:
          withdrawal.network,

        amount:
          withdrawal.amount
      },

      signing: {
        signed: false,
        broadcasted: false,
        private_key_required_here: false
      }
    });

  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL SIGN ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível preparar a assinatura."
    });
  }
}
