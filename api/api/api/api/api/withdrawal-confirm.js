import { neon } from "@neondatabase/serverless";

const TRON_API =
  "https://api.trongrid.io/wallet/gettransactioninfobyid";

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
        status,
        tx_hash
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

    if (!withdrawal.tx_hash) {
      return res.status(409).json({
        success: false,
        error:
          "A retirada ainda não possui TXID."
      });
    }

    const response = await fetch(TRON_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        value: withdrawal.tx_hash
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error:
          "Não foi possível consultar a TRON.",
        tron: data
      });
    }

    /*
     * Na TRON, receipt.result = SUCCESS
     * indica execução bem-sucedida.
     */

    const confirmed =
      data &&
      data.receipt &&
      data.receipt.result === "SUCCESS";

    if (!confirmed) {
      return res.status(200).json({
        success: true,
        status: "PENDING_CONFIRMATION",
        tx_hash: withdrawal.tx_hash,
        message:
          "A transação ainda não foi confirmada."
      });
    }

    const updated = await sql`
      UPDATE withdrawals
      SET
        status = 'COMPLETED',
        updated_at = NOW()
      WHERE withdrawal_id = ${withdrawalId}
        AND tx_hash = ${withdrawal.tx_hash}
        AND status IN ('BROADCASTED', 'CONFIRMED')
      RETURNING
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash,
        updated_at
    `;

    if (updated.length === 0) {
      return res.status(409).json({
        success: false,
        error:
          "A transação foi confirmada, mas o estado da retirada não pôde ser atualizado."
      });
    }

    return res.status(200).json({
      success: true,
      status: "COMPLETED",
      tx_hash: withdrawal.tx_hash,
      message:
        "Retirada confirmada e concluída.",
      withdrawal: updated[0]
    });

  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL CONFIRM ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível confirmar a retirada."
    });
  }
}
