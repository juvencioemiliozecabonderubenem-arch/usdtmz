import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const TRON_PRIVATE_KEY =
  process.env.TRON_PRIVATE_KEY || "";

const WITHDRAWAL_PROCESS_SECRET =
  process.env.WITHDRAWAL_PROCESS_SECRET || "";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";

const USDT_DECIMALS = 6;

const FEE_LIMIT =
  100_000_000;


/*
 * =========================================================
 * JSON
 * =========================================================
 */

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}


/*
 * =========================================================
 * TRON ADDRESS
 * =========================================================
 */

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}


/*
 * =========================================================
 * PRIVATE KEY
 * =========================================================
 */

function getPrivateKey() {
  const key =
    String(TRON_PRIVATE_KEY).trim();

  if (!key) {
    throw new Error(
      "TRON_PRIVATE_KEY não configurada."
    );
  }

  const normalized =
    key.startsWith("0x")
      ? key.slice(2)
      : key;

  if (
    !/^[0-9a-fA-F]{64}$/.test(
      normalized
    )
  ) {
    throw new Error(
      "TRON_PRIVATE_KEY inválida."
    );
  }

  return normalized;
}


/*
 * =========================================================
 * TRONWEB
 * =========================================================
 */

function createTronWeb() {
  return new TronWeb({
    fullHost: TRON_HOST,
    privateKey: getPrivateKey()
  });
}


/*
 * =========================================================
 * USDT PARSER
 * =========================================================
 */

function parseUsdtAmount(value) {
  const text =
    String(value ?? "").trim();

  if (
    !/^\d+(\.\d{1,6})?$/.test(text)
  ) {
    return null;
  }

  const [
    whole,
    decimal = ""
  ] =
    text.split(".");

  const padded =
    decimal.padEnd(
      USDT_DECIMALS,
      "0"
    );

  const raw =
    BigInt(whole) *
      1_000_000n +
    BigInt(padded);

  if (raw <= 0n) {
    return null;
  }

  return raw;
}


/*
 * =========================================================
 * FORMAT USDT
 * =========================================================
 */

function formatUsdtAmount(raw) {
  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (
      value % 1_000_000n
    )
      .toString()
      .padStart(
        6,
        "0"
      );

  return `${whole}.${decimal}`;
}


/*
 * =========================================================
 * TRONGRID REQUEST
 * =========================================================
 */

async function tronRequest(
  endpoint,
  options = {}
) {
  const response =
    await fetch(
      `${TRON_HOST}${endpoint}`,
      {
        ...options,

        headers: {
          "Content-Type":
            "application/json",

          ...(TRONGRID_API_KEY
            ? {
                "TRON-PRO-API-KEY":
                  TRONGRID_API_KEY
              }
            : {}),

          ...(options.headers || {})
        },

        cache:
          "no-store"
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      `TRONGrid HTTP ${response.status}: ${
        data?.message ||
        data?.Error ||
        text ||
        "erro desconhecido"
      }`
    );
  }

  return data;
}


/*
 * =========================================================
 * REAL USDT BALANCE
 * =========================================================
 */

async function getUsdtBalance(
  address
) {
  const response =
    await tronRequest(
      `/v1/accounts/${address}`,
      {
        method: "GET"
      }
    );

  const account =
    response?.data?.[0];

  const tokens =
    account?.trc20;

  if (!Array.isArray(tokens)) {
    return 0n;
  }

  for (const token of tokens) {
    if (
      token &&
      Object.prototype.hasOwnProperty.call(
        token,
        USDT_CONTRACT
      )
    ) {
      try {
        return BigInt(
          String(
            token[USDT_CONTRACT] ||
            "0"
          )
        );
      } catch {
        return 0n;
      }
    }
  }

  return 0n;
}


/*
 * =========================================================
 * TRX BALANCE
 * =========================================================
 */

async function getTrxBalance(
  address
) {
  const account =
    await tronRequest(
      "/wallet/getaccount",
      {
        method: "POST",

        body:
          JSON.stringify({
            address,
            visible: true
          })
      }
    );

  return (
    Number(
      account?.balance || 0
    ) /
    1_000_000
  );
}


/*
 * =========================================================
 * CONSTRUIR TRANSAÇÃO
 * =========================================================
 */

async function buildTransaction(
  tronWeb,
  ownerAddress,
  destination,
  amountRaw
) {
  const result =
    await tronWeb
      .transactionBuilder
      .triggerSmartContract(
        USDT_CONTRACT,

        "transfer(address,uint256)",

        {
          feeLimit:
            FEE_LIMIT
        },

        [
          {
            type:
              "address",

            value:
              destination
          },

          {
            type:
              "uint256",

            value:
              amountRaw.toString()
          }
        ],

        ownerAddress
      );

  if (
    !result ||
    !result.transaction
  ) {
    throw new Error(
      "TRON não retornou uma transação válida."
    );
  }

  return result.transaction;
}


/*
 * =========================================================
 * ASSINAR
 * =========================================================
 */

async function signTransaction(
  tronWeb,
  transaction
) {
  const signed =
    await tronWeb.trx.sign(
      transaction
    );

  if (
    !signed ||
    !signed.signature ||
    !signed.txID
  ) {
    throw new Error(
      "Não foi possível assinar a transação."
    );
  }

  return signed;
}


/*
 * =========================================================
 * BROADCAST
 * =========================================================
 */

async function broadcastTransaction(
  tronWeb,
  signedTransaction
) {
  const result =
    await tronWeb.trx.sendRawTransaction(
      signedTransaction
    );

  if (
    !result ||
    result.result !== true
  ) {
    throw new Error(
      result?.message
        ? `Broadcast TRON falhou: ${result.message}`
        : "Broadcast TRON falhou."
    );
  }

  return result;
}


/*
 * =========================================================
 * HANDLER
 * =========================================================
 */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return json(
      res,
      405,
      {
        success: false,
        error:
          "Método não permitido."
      }
    );
  }

  try {

    /*
     * =====================================================
     * CONFIGURAÇÃO
     * =====================================================
     */

    if (!process.env.DATABASE_URL) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "DATABASE_URL não configurada."
        }
      );
    }

    if (!TRONGRID_API_KEY) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRONGRID_API_KEY não configurada."
        }
      );
    }

    if (!TRON_PRIVATE_KEY) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRON_PRIVATE_KEY não configurada."
        }
      );
    }

    if (!WITHDRAWAL_PROCESS_SECRET) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "WITHDRAWAL_PROCESS_SECRET não configurada."
        }
      );
    }


    /*
     * =====================================================
     * AUTORIZAÇÃO INTERNA
     * =====================================================
     */

    const suppliedSecret =
      String(
        req.headers[
          "x-withdrawal-process-secret"
        ] || ""
      ).trim();

    if (
      !suppliedSecret ||
      suppliedSecret !==
        WITHDRAWAL_PROCESS_SECRET
    ) {
      return json(
        res,
        401,
        {
          success: false,
          error:
            "Processamento não autorizado."
        }
      );
    }


    /*
     * =====================================================
     * DATABASE
     * =====================================================
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * =====================================================
     * BODY
     * =====================================================
     */

    const body =
      req.body || {};

    const withdrawalId =
      String(
        body.withdrawal_id || ""
      ).trim();

    if (!withdrawalId) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "withdrawal_id é obrigatório."
        }
      );
    }


    /*
     * =====================================================
     * TRANSACTION LOCK
     * =====================================================
     *
     * Somente uma execução pode assumir
     * a retirada AUTHORIZED.
     * =====================================================
     */

    const locked =
      await sql`
        UPDATE withdrawals
        SET
          status = 'PROCESSING',
          updated_at = NOW()
        WHERE
          withdrawal_id =
            ${withdrawalId}
          AND status =
            'AUTHORIZED'
          AND tx_hash IS NULL
        RETURNING
          *
      `;


    /*
     * =====================================================
     * SE NÃO CONSEGUIU LOCK
     * =====================================================
     */

    if (
      locked.length === 0
    ) {

      const current =
        await sql`
          SELECT
            withdrawal_id,
            status,
            tx_hash,
            destination_address,
            amount_to_send
          FROM withdrawals
          WHERE withdrawal_id =
            ${withdrawalId}
          LIMIT 1
        `;

      if (
        current.length === 0
      ) {
        return json(
          res,
          404,
          {
            success: false,
            error:
              "Retirada não encontrada."
          }
        );
      }

      const withdrawal =
        current[0];

      if (
        withdrawal.tx_hash
      ) {
        return json(
          res,
          200,
          {
            success: true,
            already_processed:
              true,

            withdrawal: {
              withdrawal_id:
                withdrawal.withdrawal_id,

              status:
                withdrawal.status,

              tx_hash:
                withdrawal.tx_hash
            }
          }
        );
      }

      return json(
        res,
        409,
        {
          success: false,
          error:
            "A retirada não está disponível para processamento.",

          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status
          }
        }
      );
    }


    const withdrawal =
      locked[0];


    /*
     * =====================================================
     * VALIDAR DESTINO
     * =====================================================
     */

    const destination =
      String(
        withdrawal.destination_address ||
        ""
      ).trim();

    if (
      !isValidTronAddress(
        destination
      )
    ) {
      await sql`
        UPDATE withdrawals
        SET
          status = 'FAILED',
          updated_at = NOW()
        WHERE withdrawal_id =
          ${withdrawalId}
          AND status =
          'PROCESSING'
      `;

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Endereço TRON de destino inválido."
        }
      );
    }


    /*
     * =====================================================
     * VALIDAR ASSET / NETWORK
     * =====================================================
     */

    if (
      String(
        withdrawal.asset || ""
      ).toUpperCase() !==
      ASSET
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Asset inválido."
        }
      );
    }

    if (
      String(
        withdrawal.network || ""
      ) !==
      NETWORK
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Network inválida."
        }
      );
    }


    /*
     * =====================================================
     * VALOR
     * =====================================================
     */

    const amountRaw =
      parseUsdtAmount(
        withdrawal.amount_to_send ??
        withdrawal.amount
      );

    if (
      amountRaw === null
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Valor USDT inválido."
        }
      );
    }


    /*
     * =====================================================
     * TRONWEB
     * =====================================================
     */

    const tronWeb =
      new TronWeb({
        fullHost:
          TRON_HOST,

        privateKey:
          getPrivateKey()
      });


    /*
     * =====================================================
     * CARTEIRA DERIVADA
     * =====================================================
     */

    const walletAddress =
      tronWeb.address.fromPrivateKey(
        getPrivateKey()
      );

    if (
      !isValidTronAddress(
        walletAddress
      )
    ) {
      throw new Error(
        "Endereço derivado da chave privada inválido."
      );
    }


    /*
     * =====================================================
     * CARTEIRA DO BANCO
     * =====================================================
     */

    const wallets =
      await sql`
        SELECT
          id,
          wallet_address,
          network,
          asset,
          status
        FROM wallets
        WHERE
          network =
            ${NETWORK}
          AND asset =
            ${ASSET}
          AND status =
            'mainnet'
        ORDER BY id DESC
        LIMIT 1
      `;


    if (
      wallets.length === 0
    ) {
      throw new Error(
        "Carteira Mainnet não encontrada."
      );
    }


    const configuredWallet =
      String(
        wallets[0].wallet_address ||
        ""
      ).trim();


    /*
     * =====================================================
     * PROTEÇÃO CRÍTICA
     * =====================================================
     */

    if (
      walletAddress !==
      configuredWallet
    ) {
      throw new Error(
        "TRON_PRIVATE_KEY não corresponde à carteira Mainnet."
      );
    }


    /*
     * =====================================================
     * NÃO PERMITIR AUTOENVIO PARA A PRÓPRIA CARTEIRA
     * =====================================================
     */

    if (
      destination ===
      walletAddress
    ) {
      throw new Error(
        "O endereço de destino não pode ser a carteira operacional."
      );
    }


    /*
     * =====================================================
     * SALDO USDT REAL
     * =====================================================
     */

    const blockchainBalance =
      await getUsdtBalance(
        walletAddress
      );


    if (
      blockchainBalance <
      amountRaw
    ) {

      await sql`
        UPDATE withdrawals
        SET
          status = 'AUTHORIZED',
          updated_at = NOW()
        WHERE withdrawal_id =
          ${withdrawalId}
          AND status =
          'PROCESSING'
      `;

      return json(
        res,
        400,
        {
          success: false,

          error:
            "Saldo USDT real insuficiente.",

          blockchain_balance:
            formatUsdtAmount(
              blockchainBalance
            ),

          requested:
            formatUsdtAmount(
              amountRaw
            )
        }
      );
    }


    /*
     * =====================================================
     * SALDO TRX
     * =====================================================
     */

    const trxBalance =
      await getTrxBalance(
        walletAddress
      );


    if (
      !Number.isFinite(
        trxBalance
      )
    ) {
      throw new Error(
        "Não foi possível consultar o saldo TRX."
      );
    }


    /*
     * =====================================================
     * SEGURANÇA DE TRX
     * =====================================================
     *
     * Mantemos uma reserva mínima.
     * =====================================================
     */

    const MIN_TRX_RESERVE =
      1;

    if (
      trxBalance <
      MIN_TRX_RESERVE
    ) {

      await sql`
        UPDATE withdrawals
        SET
          status = 'AUTHORIZED',
          updated_at = NOW()
        WHERE withdrawal_id =
          ${withdrawalId}
          AND status =
          'PROCESSING'
      `;

      return json(
        res,
        400,
        {
          success: false,

          error:
            "TRX insuficiente para executar a retirada.",

          trx_balance:
            trxBalance,

          minimum_reserve:
            MIN_TRX_RESERVE
        }
      );
    }


    /*
     * =====================================================
     * CONSTRUIR
     * =====================================================
     */

    let transaction;

    try {

      transaction =
        await buildTransaction(
          tronWeb,
          walletAddress,
          destination,
          amountRaw
        );

    } catch (error) {

      await sql`
        UPDATE withdrawals
        SET
          status = 'AUTHORIZED',
          updated_at = NOW()
        WHERE withdrawal_id =
          ${withdrawalId}
          AND status =
          'PROCESSING'
      `;

      throw error;
    }


    /*
     * =====================================================
     * ASSINAR
     * =====================================================
     */

    let signedTransaction;

    try {

      signedTransaction =
        await signTransaction(
          tronWeb,
          transaction
        );

    } catch (error) {

      await sql`
        UPDATE withdrawals
        SET
          status = 'AUTHORIZED',
          updated_at = NOW()
        WHERE withdrawal_id =
          ${withdrawalId}
          AND status =
          'PROCESSING'
      `;

      throw error;
    }


    /*
     * =====================================================
     * BROADCAST MAINNET
     * =====================================================
     */

    let broadcast;

    try {

      broadcast =
        await broadcastTransaction(
          tronWeb,
          signedTransaction
        );

    } catch (error) {

      /*
       * IMPORTANTE:
       *
       * Não marcamos automaticamente como FAILED
       * se não sabemos se a rede recebeu a transação.
       *
       * Mantemos PROCESSING para investigação.
       */

      console.error(
        "USDTMZ BROADCAST ERROR:",
        error?.message ||
        error
      );

      return json(
        res,
        502,
        {
          success: false,

          error:
            "A transação foi assinada, mas o broadcast não foi confirmado.",

          withdrawal_id:
            withdrawalId,

          status:
            "PROCESSING"
        }
      );
    }


    /*
     * =====================================================
     * TX HASH
     * =====================================================
     */

    const txHash =
      String(
        broadcast?.txid ||
        signedTransaction.txID ||
        transaction.txID ||
        ""
      ).trim();


    if (!txHash) {

      return json(
        res,
        502,
        {
          success: false,

          error:
            "TRON aceitou a operação, mas nenhum TXID foi retornado.",

          withdrawal_id:
            withdrawalId,

          status:
            "PROCESSING"
        }
      );
    }


    /*
     * =====================================================
     * SALVAR TX HASH
     * =====================================================
     */

    const updated =
      await sql`
        UPDATE withdrawals
        SET
          tx_hash =
            ${txHash},

          status =
            'PROCESSING',

          updated_at =
            NOW()

        WHERE
          withdrawal_id =
            ${withdrawalId}

          AND status =
            'PROCESSING'

          AND tx_hash IS NULL

        RETURNING
          withdrawal_id,
          destination_address,
          amount_to_send,
          status,
          tx_hash,
          updated_at
      `;


    if (
      updated.length === 0
    ) {

      return json(
        res,
        409,
        {
          success: false,

          error:
            "A transação foi transmitida, mas a retirada não pôde ser atualizada no banco.",

          tx_hash:
            txHash
        }
      );
    }


    /*
     * =====================================================
     * RESPOSTA
     * =====================================================
     */

    return json(
      res,
      200,
      {

        success:
          true,

        automatic:
          true,

        broadcasted:
          true,

        mode:
          "TRON_MAINNET",

        withdrawal: {

          withdrawal_id:
            withdrawalId,

          destination:
            destination,

          amount:
            formatUsdtAmount(
              amountRaw
            ),

          asset:
            ASSET,

          network:
            NETWORK,

          standard:
            "TRC-20",

          contract:
            USDT_CONTRACT,

          status:
            "PROCESSING",

          tx_hash:
            txHash

        },

        blockchain: {

          wallet:
            walletAddress,

          usdt_balance_before:
            formatUsdtAmount(
              blockchainBalance
            ),

          trx_balance:
            trxBalance

        },

        transaction: {

          txID:
            txHash,

          broadcasted:
            true

        }

      }
    );

  } catch (error) {

    console.error(
      "USDTMZ PROCESS WITHDRAWAL ERROR:",
      error?.message ||
      error
    );

    return json(
      res,
      500,
      {
        success: false,

        error:
          "Erro interno ao processar a retirada.",

        details:
          process.env.NODE_ENV ===
          "development"
            ? (
                error?.message ||
                String(error)
              )
            : undefined
      }
    );
  }
}
