import { neon } from "@neondatabase/serverless";

const TRON_API =
  "https://api.trongrid.io/wallet/broadcasttransaction";

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
      signed_transaction
    } = req.body || {};

    const withdrawalId =
      String(withdrawal_id || "").trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Informe o withdrawal_id."
      });
    }

    if (
      !signed_transaction ||
      typeof signed_transaction !== "object"
    ) {
      return res.status(400).json({
        success: false,
        error: "Transação assinada não informada."
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
          "A retirada não está autorizada para transmissão."
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

    const response = await fetch(TRON_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(signed_transaction)
    });

    const data = await response.json();

    if (!response.ok || !data.result) {
      console.error(
        "TRON BROADCAST ERROR:",
        data
      );

      return res.status(502).json({
        success: false,
        error:
          data.message ||
          "A TRON recusou a transmissão.",
        tron: data
      });
    }

    const txid =
      data.txid ||
      signed_transaction.txID ||
      null;

    await sql`
      UPDATE withdrawals
      SET
        status = 'BROADCASTED',
        tx_hash = ${txid},
        updated_at = NOW()
      WHERE withdrawal_id = ${withdrawalId}
        AND status = 'AUTHORIZED'
    `;

    return res.status(200).json({
      success: true,
      status: "BROADCASTED",
      tx_hash: txid,
      message:
        "Transação transmitida para a rede TRON."
    });

  } catch (error) {

    console.error(
      "USDTMZ BROADCAST ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível transmitir a transação."
    });
  }
}
