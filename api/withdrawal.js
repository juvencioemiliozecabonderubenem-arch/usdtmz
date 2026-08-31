import { neon } from "@neondatabase/serverless";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;
const MAX_WITHDRAWAL_USDT = 1_000_000;

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";

/*
 * Taxa comercial do USDTMZ.
 *
 * Exemplo:
 * pedido = 10 USDT
 * taxa = 1 USDT
 * envio = 9 USDT
 */
const WITHDRAWAL_FEE_USDT = 1;

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

  const padded = decimal.padEnd(USDT_DECIMALS, "0");

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
      .padStart(USDT_DECIMALS, "0");

  return `${whole}.${decimal}`;
}

function numericToRaw(value) {
  return parseUsdtAmount(value) || 0n;
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
        error: "DATABASE_URL não configurada no Vercel."
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    const body = req.body || {};

    const address =
      String(body.address || "").trim();

    const amount =
      String(body.amount ?? "").trim();

    /*
     * VALIDA ENDEREÇO
     */
    if (!isValidTronAddress(address)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    /*
     * VALIDA VALOR SOLICITADO
     */
    const requestedRaw =
      parseUsdtAmount(amount);

    if (requestedRaw === null) {
      return res.status(400).json({
        success: false,
        error:
          "Valor USDT inválido. Use até 6 casas decimais."
      });
    }

    /*
     * TAXA
     */
    const feeRaw =
      parseUsdtAmount(
        WITHDRAWAL_FEE_USDT.toString()
      );

    if (feeRaw === null) {
      return res.status(500).json({
        success: false,
        error: "Configuração de taxa inválida."
      });
    }

    /*
     * NÃO PERMITIR PEDIDO IGUAL OU MENOR À TAXA
     */
    if (requestedRaw <= feeRaw) {
      return res.status(400).json({
        success: false,
        error:
          "O valor solicitado deve ser maior que a taxa de retirada.",
        requested:
          formatUsdtAmount(requestedRaw),
        fee:
          formatUsdtAmount(feeRaw)
      });
    }

    const amountToSendRaw =
      requestedRaw - feeRaw;

    const amountRequested =
      formatUsdtAmount(requestedRaw);

    const withdrawalFee =
      formatUsdtAmount(feeRaw);

    const amountToSend =
      formatUsdtAmount(amountToSendRaw);

    /*
     * LOCALIZAR CARTEIRA
     */
    const wallets = await sql`
      SELECT
        id,
        wallet_address,
        network,
        asset,
        balance,
        status
      FROM wallets
      WHERE network = ${NETWORK}
        AND asset = ${ASSET}
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;

    if (wallets.length === 0) {
      return res.status(404).json({
        success: false,
        error:
          "Nenhuma carteira USDT TRON Mainnet configurada."
      });
    }

    const wallet = wallets[0];

    const walletAddress =
      String(wallet.wallet_address || "").trim();

    if (!isValidTronAddress(walletAddress)) {
      return res.status(500).json({
        success: false,
        error:
          "A carteira Mainnet configurada é inválida."
      });
    }

    /*
     * SALDO INTERNO
     *
     * O saldo precisa cobrir o valor solicitado
     * incluindo a taxa.
     */
    const walletRawBalance =
      numericToRaw(wallet.balance);

    if (walletRawBalance < requestedRaw) {
      return res.status(400).json({
        success: false,
        error:
          "Saldo USDT insuficiente para esta retirada.",
        wallet: {
          network: NETWORK,
          asset: ASSET,
          balance:
            formatUsdtAmount(walletRawBalance),
          requested:
            amountRequested,
          fee:
            withdrawalFee,
          amount_to_send:
            amountToSend
        }
      });
    }

    /*
     * DUPLICAÇÃO
     */
    const duplicated = await sql`
      SELECT
        id,
        withdrawal_id,
        status
      FROM withdrawals
      WHERE destination_address = ${address}
        AND amount_to_send = ${amountToSend}
        AND status IN (
          'PENDING',
          'AUTHORIZED',
          'PROCESSING'
        )
      LIMIT 1
    `;

    if (duplicated.length > 0) {
      return res.status(409).json({
        success: false,
        error:
          "Já existe uma retirada pendente para este endereço e valor.",
        withdrawal: {
          withdrawal_id:
            duplicated[0].withdrawal_id,
          status:
            duplicated[0].status
        }
      });
    }

    /*
     * IDENTIFICADORES
     */
    const withdrawalId =
      "WD-" +
      Date.now()
        .toString(36)
        .toUpperCase();

    const orderId = withdrawalId;

    /*
     * CRIAR RETIRADA
     *
     * amount = valor líquido que será enviado.
     */
    const result = await sql`
      INSERT INTO withdrawals (
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash,
        order_id,
        amount_requested,
        withdrawal_fee,
        amount_to_send
      )
      VALUES (
        ${withdrawalId},
        ${address},
        ${ASSET},
        ${NETWORK},
        ${amountToSend},
        'PENDING',
        NULL,
        ${orderId},
        ${amountRequested},
        ${withdrawalFee},
        ${amountToSend}
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
        amount_requested,
        withdrawal_fee,
        amount_to_send,
        created_at,
        updated_at
    `;

    const withdrawal = result[0];

    return res.status(201).json({
      success: true,

      message:
        "Pedido de retirada criado e aguardando autorização.",

      withdrawal: {
        id:
          withdrawal.id,

        withdrawal_id:
          withdrawal.withdrawal_id,

        address:
          withdrawal.destination_address,

        destination_address:
          withdrawal.destination_address,

        amount_requested:
          withdrawal.amount_requested,

        withdrawal_fee:
          withdrawal.withdrawal_fee,

        amount_to_send:
          withdrawal.amount_to_send,

        amount:
          withdrawal.amount,

        asset:
          withdrawal.asset,

        network:
          NETWORK,

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

        wallet_balance:
          formatUsdtAmount(walletRawBalance),

        created_at:
          withdrawal.created_at,

        updated_at:
          withdrawal.updated_at
      }
    });

  } catch (error) {
    console.error(
      "USDTMZ WITHDRAWAL ERROR:",
      error?.message || error
    );

    return res.status(500).json({
      success: false,
      error:
        "Erro interno ao criar o pedido de retirada."
    });
  }
}
