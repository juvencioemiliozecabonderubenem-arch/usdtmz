import { neon } from "@neondatabase/serverless";

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function generateWithdrawalId() {
  const random =
    Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();

  return `USDTMZ-WD-${random}`;
}

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

    const sql =
      neon(process.env.DATABASE_URL);

    const {
      destination_address,
      amount
    } = req.body || {};

    const address =
      String(destination_address || "").trim();

    const value =
      String(amount || "").trim();

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Informe o endereço TRON de destino."
      });
    }

    if (!isValidTronAddress(address)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    if (!value) {
      return res.status(400).json({
        success: false,
        error: "Informe o valor em USDT."
      });
    }

    const amountNumber =
      Number(value);

    if (
      !Number.isFinite(amountNumber) ||
      amountNumber <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Valor USDT inválido."
      });
    }

    if (amountNumber > 1000000000) {
      return res.status(400).json({
        success: false,
        error: "Valor USDT demasiado elevado."
      });
    }

    const withdrawalId =
      generateWithdrawalId();

    const result = await sql`
      INSERT INTO withdrawals (
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status
      )
      VALUES (
        ${withdrawalId},
        ${address},
        'USDT',
        'TRON Mainnet',
        ${amountNumber},
        'PENDING'
      )
      RETURNING
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        created_at
    `;

    return res.status(201).json({
      success: true,
      message:
        "Solicitação de envio criada.",
      withdrawal: result[0]
    });

  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível criar a solicitação de envio."
    });
  }
}
