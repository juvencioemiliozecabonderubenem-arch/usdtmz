import { neon } from "@neondatabase/serverless";

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";
const STANDARD = "TRC-20";
const USER_ID = "owner";
const USDT_DECIMALS = 6;

// =========================================================
// JSON
// =========================================================

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(status)
    .json(data);
}

// =========================================================
// TRON ADDRESS
// =========================================================

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

// =========================================================
// USDT → BIGINT
// =========================================================

function parseUsdtAmount(value) {
  const text =
    String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] =
    text.split(".");

  const padded =
    decimal.padEnd(
      USDT_DECIMALS,
      "0"
    );

  try {
    const raw =
      BigInt(whole) * 1_000_000n +
      BigInt(padded);

    if (raw <= 0n) {
      return null;
    }

    return raw;

  } catch {
    return null;
  }
}

// =========================================================
// FORMAT USDT
// =========================================================

function formatUsdtAmount(raw) {
  try {
    const value =
      BigInt(raw);

    const whole =
      value / 1_000_000n;

    const decimal =
      (value % 1_000_000n)
        .toString()
        .padStart(6, "0");

    return `${whole}.${decimal}`;

  } catch {
    return "0.000000";
  }
}

// =========================================================
// BODY
// =========================================================

function getBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

// =========================================================
// HANDLER
// =========================================================

export default async function handler(req, res) {

  // =======================================================
  // MÉTODO
  // =======================================================

  if (req.method !== "POST") {

    res.setHeader(
      "Allow",
      "POST"
    );

    return json(res, 405, {
      success: false,
      error:
        "Método não permitido."
    });
  }

  try {

    // =====================================================
    // DATABASE
    // =====================================================

    if (!process.env.DATABASE_URL) {

      return json(res, 500, {
        success: false,
        error:
          "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(
        process.env.DATABASE_URL
      );

    // =====================================================
    // BODY
    // =====================================================

    const body =
      getBody(req);

    const destinationAddress =
      String(
        body.destination_address ||
        body.address ||
        body.destination ||
        ""
      ).trim();

    const amountInput =
      body.amount_to_send ??
      body.amount;

    const requestedWithdrawalId =
      String(
        body.withdrawal_id || ""
      ).trim();

    // =====================================================
    // DESTINO
    // =====================================================

    if (
      !isValidTronAddress(
        destinationAddress
      )
    ) {

      return json(res, 400, {
        success: false,
        error:
          "Endereço TRON inválido."
      });
    }

    // =====================================================
    // VALOR
    // =====================================================

    const amountRaw =
      parseUsdtAmount(
        amountInput
      );

    if (amountRaw === null) {

      return json(res, 400, {
        success: false,
        error:
          "Valor USDT inválido. Use até 6 casas decimais."
      });
    }

    const amount =
      formatUsdtAmount(
        amountRaw
      );

    // =====================================================
    // LIMITE
    // =====================================================

    const MAX_WITHDRAWAL_USDT =
      1_000_000n * 1_000_000n;

    if (
      amountRaw >
      MAX_WITHDRAWAL_USDT
    ) {

      return json(res, 400, {
        success: false,
        error:
          "O valor máximo permitido é 1.000.000 USDT."
      });
    }

    // =====================================================
    // IDEMPOTÊNCIA
    // =====================================================

    if (requestedWithdrawalId) {

      const existing =
        await sql`

          SELECT
            withdrawal_id,
            user_id,
            destination_address,
            amount_to_send,
            asset,
            network,
            status,
            tx_hash,
            created_at,
            updated_at

          FROM withdrawals

          WHERE
            withdrawal_id =
              ${requestedWithdrawalId}

            AND
            user_id =
              ${USER_ID}

          LIMIT 1

        `;

      if (existing.length === 0) {

        return json(res, 404, {
          success: false,
          error:
            "Retirada não encontrada."
        });
      }

      const withdrawal =
        existing[0];

      return json(res, 200, {

        success: true,

        created: false,

        idempotent: true,

        automatic: false,

        next_step:
          "/api/process-withdrawal",

        withdrawal: {

          withdrawal_id:
            withdrawal.withdrawal_id,

          user_id:
            withdrawal.user_id,

          destination_address:
            withdrawal.destination_address,

          amount:
            withdrawal.amount_to_send,

          asset:
            withdrawal.asset,

          network:
            withdrawal.network,

          standard:
            STANDARD,

          status:
            withdrawal.status,

          tx_hash:
            withdrawal.tx_hash ||
            null

        }

      });
    }

    // =====================================================
    // CRIAR RETIRADA
    // =====================================================
    //
    // IMPORTANTE:
    //
    // O user_id NÃO vem do navegador.
    //
    // O sistema utiliza o usuário interno:
    //
    // owner
    //
    // A retirada começa como PENDING.
    //
    // O saldo NÃO é debitado nesta etapa.
    //
    // O processamento/autorização deverá acontecer
    // posteriormente no servidor.
    // =====================================================

    const result =
      await sql`

        INSERT INTO withdrawals (

          user_id,
          destination_address,
          amount_to_send,
          asset,
          network,
          status,
          tx_hash,
          created_at,
          updated_at

        )

        VALUES (

          ${USER_ID},
          ${destinationAddress},
          ${amount},
          ${ASSET},
          ${NETWORK},
          'PENDING',
          NULL,
          NOW(),
          NOW()

        )

        RETURNING

          withdrawal_id,
          user_id,
          destination_address,
          amount_to_send,
          asset,
          network,
          status,
          tx_hash,
          created_at,
          updated_at

      `;

    // =====================================================
    // SEGURANÇA
    // =====================================================

    if (result.length === 0) {

      return json(res, 500, {
        success: false,
        error:
          "Não foi possível criar a retirada."
      });
    }

    const withdrawal =
      result[0];

    // =====================================================
    // SALDO ATUAL
    // =====================================================

    const balanceResult =
      await sql`

        SELECT
          usdt_balance,
          updated_at

        FROM balances

        WHERE
          user_id =
            ${USER_ID}

        LIMIT 1

      `;

    let balanceAvailable =
      "0.000000";

    if (
      balanceResult.length > 0
    ) {

      const balanceRaw =
        parseUsdtAmount(
          balanceResult[0]
            .usdt_balance
        );

      if (
        balanceRaw !== null
      ) {

        balanceAvailable =
          formatUsdtAmount(
            balanceRaw
          );
      }
    }

    // =====================================================
    // RESPOSTA
    // =====================================================

    return json(res, 201, {

      success: true,

      created: true,

      automatic: false,

      next_step:
        "/api/process-withdrawal",

      message:
        "Pedido de retirada criado e aguardando autorização.",

      withdrawal: {

        withdrawal_id:
          withdrawal.withdrawal_id,

        user_id:
          withdrawal.user_id,

        destination_address:
          withdrawal.destination_address,

        amount:
          withdrawal.amount_to_send,

        asset:
          withdrawal.asset,

        network:
          withdrawal.network,

        standard:
          STANDARD,

        status:
          withdrawal.status,

        tx_hash:
          withdrawal.tx_hash ||
          null,

        created_at:
          withdrawal.created_at

      },

      balance: {

        available:
          balanceAvailable,

        requested:
          amount

      }

    });

  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {

      success: false,

      error:
        "Erro interno ao criar a retirada."

    });
  }
}
