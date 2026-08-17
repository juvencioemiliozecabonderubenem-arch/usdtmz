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
      UPDATE withdrawals
      SET
        status = 'AUTHORIZED',
        updated_at = NOW()
      WHERE withdrawal_id = ${withdrawalId}
        AND status = 'PENDING'
      RETURNING
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        created_at,
        updated_at
    `;

    if (result.length === 0) {
      return res.status(409).json({
        success: false,
        error:
          "Retirada não encontrada ou não está em PENDING."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Retirada autorizada.",
      withdrawal: result[0]
    });

  } catch (error) {
    console.error(
      "USDTMZ WITHDRAWAL AUTHORIZE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível autorizar a retirada."
    });
  }
}
