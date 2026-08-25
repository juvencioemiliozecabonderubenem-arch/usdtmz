import { neon } from "@neondatabase/serverless";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;
const MAX_WITHDRAWAL_USDT = 1_000_000;

const sql = neon(process.env.DATABASE_URL);

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

function parseUsdtAmount(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] = text.split(".");

  const padded =
    decimal.padEnd(USDT_DECIMALS, "0");

  const raw =
    BigInt(whole) * 1_000_000n +
    BigInt(padded);

  if (raw <= 0n) {
    return null;
  }

  const max =
    BigInt(MAX_WITHDRAWAL_USDT) *
    1_000_000n;

  if (raw > max) {
    return null;
  }

  return raw;
}

function formatUsdtAmount(raw) {
  const value = BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (value % 1_000_000n)
      .toString()
      .padStart(6, "0");

  return `${whole}.${decimal}`;
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

    const body =
      req.body || {};

    const address =
      String(
        body.address || ""
      ).trim();

    const amount =
      body.amount;


    /* =========================
       VALIDAR ENDEREÇO
    ========================= */

    if (!isValidTronAddress(address)) {

      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });

    }


    /* =========================
       VALIDAR VALOR
    ========================= */

    const rawAmount =
      parseUsdtAmount(amount);

    if (rawAmount === null) {

      return res.status(400).json({
        success: false,
        error:
          "Valor USDT inválido. Use até 6 casas decimais."
      });

    }


    const amountFormatted =
      formatUsdtAmount(rawAmount);


    /* =========================
       IDENTIFICADORES
    ========================= */

    const withdrawalId =
      "WD-" +
      Date.now()
        .toString(36)
        .toUpperCase();

    const orderId =
      withdrawalId;


    /* =========================
       CRIAR RETIRADA
    ========================= */

    const result = await sql`

      INSERT INTO withdrawals (

        withdrawal_id,

        destination_address,

        asset,

        network,

        amount,

        status,

        tx_hash,

        order_id

      )

      VALUES (

        ${withdrawalId},

        ${address},

        'USDT',

        'TRON',

        ${amountFormatted},

        'PENDING',

        NULL,

        ${orderId}

      )

      RETURNING

        id,

        withdrawal_id,

        destination_address,

        asset,

        network,

        amount,

        status,

        tx_hash,

        order_id,

        created_at

    `;


    const withdrawal =
      result[0];


    /* =========================
       RESPOSTA
    ========================= */

    return res.status(201).json({

      success: true,

      message:
        "Pedido de retirada recebido e aguardando autorização.",

      withdrawal: {

        id:
          withdrawal.id,

        withdrawal_id:
          withdrawal.withdrawal_id,

        address:
          withdrawal.destination_address,

        destination_address:
          withdrawal.destination_address,

        amount:
          withdrawal.amount,

        asset:
          withdrawal.asset,

        network:
          "TRON Mainnet",

        standard:
          "TRC-20",

        contract:
          USDT_CONTRACT,

        status:
          withdrawal.status,

        tx_hash:
          withdrawal.tx_hash,

        broadcasted:
          false,

        created_at:
          withdrawal.created_at

      }

    });


  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL ERROR:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Erro interno ao criar o pedido de retirada."

    });

  }

}
