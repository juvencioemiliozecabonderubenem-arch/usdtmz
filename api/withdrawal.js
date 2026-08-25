import { neon } from "@neondatabase/serverless";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;
const MAX_WITHDRAWAL_USDT = 1_000_000;

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";

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
      .padStart(USDT_DECIMALS, "0");

  return `${whole}.${decimal}`;
}

function numericToRaw(value) {
  const text =
    String(value ?? "0").trim();

  return parseUsdtAmount(text) || 0n;
}

export default async function handler(req, res) {

  /*
   * =========================
   * MÉTODO
   * =========================
   */

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });

  }


  try {

    /*
     * =========================
     * DATABASE
     * =========================
     */

    if (!process.env.DATABASE_URL) {

      return res.status(500).json({
        success: false,
        error:
          "DATABASE_URL não configurada no Vercel."
      });

    }

    const sql =
      neon(process.env.DATABASE_URL);


    /*
     * =========================
     * DADOS RECEBIDOS
     * =========================
     */

    const body =
      req.body || {};

    const address =
      String(
        body.address || ""
      ).trim();

    const amount =
      String(
        body.amount ?? ""
      ).trim();


    /*
     * =========================
     * VALIDAR ENDEREÇO
     * =========================
     */

    if (!isValidTronAddress(address)) {

      return res.status(400).json({
        success: false,
        error:
          "Endereço TRON inválido."
      });

    }


    /*
     * =========================
     * VALIDAR VALOR
     * =========================
     */

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


    /*
     * =========================
     * LOCALIZAR CARTEIRA
     * =========================
     */

    const wallets =
      await sql`

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


    const wallet =
      wallets[0];


    /*
     * =========================
     * VALIDAR CARTEIRA
     * =========================
     */

    const walletAddress =
      String(
        wallet.wallet_address || ""
      ).trim();


    if (!isValidTronAddress(walletAddress)) {

      return res.status(500).json({
        success: false,
        error:
          "A carteira Mainnet configurada é inválida."
      });

    }


    /*
     * =========================
     * SALDO
     * =========================
     *
     * O saldo é lido da tabela wallets.
     *
     * IMPORTANTE:
     * esta etapa NÃO modifica o saldo.
     */

    const walletRawBalance =
      numericToRaw(wallet.balance);


    /*
     * =========================
     * VERIFICAR SALDO
     * =========================
     */

    if (
      walletRawBalance <
      rawAmount
    ) {

      return res.status(400).json({

        success: false,

        error:
          "Saldo USDT insuficiente para esta retirada.",

        wallet: {

          network:
            NETWORK,

          asset:
            ASSET,

          balance:
            formatUsdtAmount(
              walletRawBalance
            ),

          requested:
            amountFormatted

        }

      });

    }


    /*
     * =========================
     * VERIFICAR RETIRADAS
     * =========================
     *
     * Não permitimos criar outra
     * retirada PENDING para o mesmo
     * destino e valor simultaneamente.
     */

    const duplicated =
      await sql`

        SELECT
          id,
          withdrawal_id,
          status

        FROM withdrawals

        WHERE destination_address =
          ${address}

          AND amount =
          ${amountFormatted}

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
     * =========================
     * IDENTIFICADORES
     * =========================
     */

    const withdrawalId =
      "WD-" +
      Date.now()
        .toString(36)
        .toUpperCase();

    const orderId =
      withdrawalId;


    /*
     * =========================
     * CRIAR RETIRADA
     * =========================
     *
     * A retirada fica PENDING.
     *
     * Nenhuma transação é enviada
     * para a TRON nesta etapa.
     */

    const result =
      await sql`

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

          ${ASSET},

          ${NETWORK},

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

          created_at,

          updated_at

      `;


    const withdrawal =
      result[0];


    /*
     * =========================
     * RESPOSTA
     * =========================
     */

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
          formatUsdtAmount(
            walletRawBalance
          ),

        created_at:
          withdrawal.created_at,

        updated_at:
          withdrawal.updated_at

      }

    });


  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL ERROR:",
      error?.message ||
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Erro interno ao criar o pedido de retirada."

    });

  }

}
