import { neon } from "@neondatabase/serverless";

const MAX_WITHDRAWAL_USDT = 1000000;
const USDT_DECIMALS = 6;

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

function isValidUsdtAmount(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }

  return Number.isInteger(
    value * 10 ** USDT_DECIMALS
  );
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

    const sql = neon(process.env.DATABASE_URL);

    const {
      destination_address,
      amount
    } = req.body || {};

    const address =
      String(destination_address || "").trim();

    const value =
      String(amount ?? "").trim();

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

    const amountNumber = Number(value);

    if (!isValidUsdtAmount(amountNumber)) {
      return res.status(400).json({
        success: false,
        error:
          "Valor USDT inválido. Use um valor maior que zero com no máximo 6 casas decimais."
      });
    }

    if (amountNumber > MAX_WITHDRAWAL_USDT) {
      return res.status(400).json({
        success: false,
        error:
          "O valor máximo por retirada é 1.000.000 USDT."
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
        "Solicitação de retirada criada com sucesso.",
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
        "Não foi possível criar a solicitação de retirada."
    });
  }
}
:::
