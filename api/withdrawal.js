import { neon } from "@neondatabase/serverless";

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";
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
// USDT AMOUNT → BIGINT
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
    decimal
      .padEnd(USDT_DECIMALS, "0");

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

export default async function handler(
  req,
  res
) {
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
    // =======================================================
    // DATABASE
    // =======================================================

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

    // =======================================================
    // BODY
    // =======================================================

    const body =
      getBody(req);

    const userId =
      String(
        body.user_id || ""
      ).trim();

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

    // =======================================================
    // USER
    // =======================================================

    if (!userId) {
      return json(res, 400, {
        success: false,
        error:
          "user_id é obrigatório."
      });
    }

    // =======================================================
    // DESTINO
    // =======================================================

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

    // =======================================================
    // VALOR
    // =======================================================

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

    // =======================================================
    // IDEMPOTÊNCIA
    // =======================================================

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
              ${userId}

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

          destination:
            withdrawal.destination_address,

          amount:
            withdrawal.amount_to_send,

          asset:
            withdrawal.asset,

          network:
            withdrawal.network,

          standard:
            "TRC-20",

          status:
            withdrawal.status,

          tx_hash:
            withdrawal.tx_hash ||
            null
        }
      });
    }

    // =======================================================
    // DÉBITO + CRIAÇÃO
    // =======================================================
    //
    // IMPORTANTE:
    // A tabela utilizada aqui é "balances",
    // igual ao saldo.js.
    //
    // O débito e a criação da retirada
    // acontecem na mesma operação SQL.
    // =======================================================

    const result =
      await sql`

        WITH debited AS (

          UPDATE balances

          SET

            usdt_balance =
              usdt_balance - ${amount},

            updated_at =
              NOW()

          WHERE
            user_id =
              ${userId}

            AND
            usdt_balance >=
              ${amount}

          RETURNING
            user_id,
            usdt_balance

        )

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

        SELECT

          user_id,
          ${destinationAddress},
          ${amount},
          ${ASSET},
          ${NETWORK},

          'AUTHORIZED',

          NULL,

          NOW(),
          NOW()

        FROM debited

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

    // =======================================================
    // SALDO INSUFICIENTE / UTILIZADOR NÃO ENCONTRADO
    // =======================================================

    if (result.length === 0) {

      const balances =
        await sql`

          SELECT
            user_id,
            usdt_balance

          FROM balances

          WHERE user_id =
            ${userId}

          LIMIT 1

        `;

      if (balances.length === 0) {
        return json(res, 404, {
          success: false,
          error:
            "Saldo do utilizador não encontrado."
        });
      }

      const currentRaw =
        parseUsdtAmount(
          balances[0].usdt_balance
        );

      const currentBalance =
        currentRaw === null
          ? "0.000000"
          : formatUsdtAmount(
              currentRaw
            );

      return json(res, 400, {
        success: false,

        error:
          "Saldo USDT insuficiente.",

        balance:
          currentBalance,

        requested:
          amount
      });
    }

    // =======================================================
    // RETIRADA CRIADA
    // =======================================================

    const withdrawal =
      result[0];

    // =======================================================
    // SALDO APÓS DÉBITO
    // =======================================================

    const balanceResult =
      await sql`

        SELECT
          usdt_balance

        FROM balances

        WHERE user_id =
          ${userId}

        LIMIT 1

      `;

    let balanceAfter =
      "0.000000";

    if (
      balanceResult.length > 0
    ) {
      const parsed =
        parseUsdtAmount(
          balanceResult[0]
            .usdt_balance
        );

      if (parsed !== null) {
        balanceAfter =
          formatUsdtAmount(
            parsed
          );
      }
    }

    // =======================================================
    // RESPOSTA
    // =======================================================

    return json(res, 201, {

      success: true,

      created: true,

      automatic: false,

      next_step:
        "/api/process-withdrawal",

      withdrawal: {

        withdrawal_id:
          withdrawal.withdrawal_id,

        user_id:
          withdrawal.user_id,

        destination:
          withdrawal.destination_address,

        amount:
          withdrawal.amount_to_send,

        asset:
          withdrawal.asset,

        network:
          withdrawal.network,

        standard:
          "TRC-20",

        status:
          withdrawal.status,

        tx_hash:
          withdrawal.tx_hash ||
          null
      },

      balance: {

        available:
          balanceAfter,

        requested:
          amount,

        debited:
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
        "Erro interno ao criar a retirada.",

      details:
        process.env.NODE_ENV ===
        "development"
          ? (
              error?.message ||
              String(error)
            )
          : undefined
    });
  }
}
