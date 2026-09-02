// /api/process-withdrawal.js
//
// USDTMZ — PROCESS WITHDRAWAL
// TRON MAINNET / USDT TRC-20
//
// FLUXO:
//
// PENDING
//    ↓
// ADMIN AUTORIZA
//    ↓
// AUTHORIZED
//    ↓
// validação
//    ↓
// saldo USDT real
//    ↓
// construção
//    ↓
// assinatura no servidor
//    ↓
// broadcast TRON
//    ↓
// TXID
//    ↓
// PROCESSING
//    ↓
// confirmação on-chain
//    ↓
// COMPLETED
//
// IMPORTANTE:
//
// - TRON_PRIVATE_KEY fica somente no servidor
// - nunca é enviada ao frontend
// - não usa TronLink
// - não aceita user_id enviado pelo navegador
// - trabalha com a carteira interna "owner"
// - não marca COMPLETED antes da confirmação blockchain
//

import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";
const STANDARD = "TRC-20";

const USER_ID = "owner";

const USDT_DECIMALS = 6;

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const TRON_PRIVATE_KEY =
  process.env.TRON_PRIVATE_KEY || "";

const MAX_WITHDRAWAL_USDT =
  1_000_000;

const FEE_LIMIT =
  Number(
    process.env.TRON_FEE_LIMIT ||
    100_000_000
  );


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

  return res
    .status(status)
    .json(data);
}


/*
 * =========================================================
 * BODY
 * =========================================================
 */

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
  ] = text.split(".");

  const padded =
    decimal.padEnd(
      USDT_DECIMALS,
      "0"
    );

  try {
    const raw =
      BigInt(whole) *
        1_000_000n +
      BigInt(padded);

    const max =
      BigInt(MAX_WITHDRAWAL_USDT) *
      1_000_000n;

    if (
      raw <= 0n ||
      raw > max
    ) {
      return null;
    }

    return raw;

  } catch {
    return null;
  }
}


/*
 * =========================================================
 * FORMAT USDT
 * =========================================================
 */

function formatUsdtAmount(raw) {
  try {
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
          USDT_DECIMALS,
          "0"
        );

    return `${whole}.${decimal}`;

  } catch {
    return "0.000000";
  }
}


/*
 * =========================================================
 * PRIVATE KEY
 * =========================================================
 */

function getPrivateKey() {
  const key =
    String(
      TRON_PRIVATE_KEY
    ).trim();

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
 * TRON REQUEST
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
          Accept:
            "application/json",

          "Content-Type":
            "application/json",

          ...(TRONGRID_API_KEY
            ? {
                "TRON-PRO-API-KEY":
                  TRONGRID_API_KEY
              }
            : {}),

          ...(options.headers || {})
        }
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
      `TRONGrid HTTP ${response.status}`
    );
  }

  return data;
}


/*
 * =========================================================
 * TRONWEB
 * =========================================================
 */

function createTronWeb() {
  return new TronWeb({
    fullHost:
      TRON_HOST,

    privateKey:
      getPrivateKey()
  });
}


/*
 * =========================================================
 * SERVER WALLET
 * =========================================================
 */

function getServerAddress(tronWeb) {
  const address =
    tronWeb.address.fromPrivateKey(
      getPrivateKey()
    );

  if (
    !isValidTronAddress(address)
  ) {
    throw new Error(
      "A chave privada não corresponde a uma carteira TRON válida."
    );
  }

  return address;
}


/*
 * =========================================================
 * ACCOUNT
 * =========================================================
 */

async function getAccount(address) {
  return tronRequest(
    "/wallet/getaccount",
    {
      method: "POST",

      body: JSON.stringify({
        address,
        visible: true
      })
    }
  );
}


/*
 * =========================================================
 * USDT BALANCE
 * =========================================================
 */

async function getUsdtBalance(address) {
  const data =
    await tronRequest(
      `/v1/accounts/${address}/trc20/balance?contract_address=${USDT_CONTRACT}`,
      {
        method: "GET"
      }
    );

  const items =
    Array.isArray(data?.data)
      ? data.data
      : [];

  const token =
    items.find(item => {
      const contract =
        String(
          item?.token_id ||
          item?.contract_address ||
          ""
        ).toLowerCase();

      return (
        contract ===
        USDT_CONTRACT.toLowerCase()
      );
    });

  if (!token) {
    return 0n;
  }

  try {
    return BigInt(
      String(
        token.balance ||
        "0"
      )
    );
  } catch {
    return 0n;
  }
}


/*
 * =========================================================
 * ACCOUNT RESOURCES
 * =========================================================
 */

async function getAccountResources(address) {
  return tronRequest(
    "/wallet/getaccountresource",
    {
      method: "POST",

      body: JSON.stringify({
        address,
        visible: true
      })
    }
  );
}


/*
 * =========================================================
 * BUILD TRANSFER PARAMETER
 * =========================================================
 */

function buildTransferParameter(
  tronWeb,
  destination,
  rawAmount
) {
  const destinationHex =
    tronWeb.address.toHex(
      destination
    );

  const addressHex =
    destinationHex
      .replace(/^41/, "")
      .padStart(64, "0");

  const amountHex =
    rawAmount
      .toString(16)
      .padStart(64, "0");

  return (
    addressHex +
    amountHex
  );
}


/*
 * =========================================================
 * SIMULATE TRANSFER
 * =========================================================
 */

async function simulateTransfer(
  tronWeb,
  sender,
  destination,
  rawAmount
) {
  const parameter =
    buildTransferParameter(
      tronWeb,
      destination,
      rawAmount
    );

  return tronRequest(
    "/wallet/triggerconstantcontract",
    {
      method: "POST",

      body: JSON.stringify({
        owner_address:
          sender,

        contract_address:
          USDT_CONTRACT,

        function_selector:
          "transfer(address,uint256)",

        parameter,

        call_value: 0,

        visible: true
      })
    }
  );
}


/*
 * =========================================================
 * BUILD TRANSACTION
 * =========================================================
 */

async function buildTransaction(
  tronWeb,
  sender,
  destination,
  rawAmount
) {
  const result =
    await tronWeb
      .transactionBuilder
      .triggerSmartContract(
        USDT_CONTRACT,

        "transfer(address,uint256)",

        {
          feeLimit:
            FEE_LIMIT,

          callValue:
            0
        },

        [
          {
            type: "address",
            value: destination
          },

          {
            type: "uint256",
            value:
              rawAmount.toString()
          }
        ],

        sender
      );

  if (
    !result ||
    !result.result ||
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
 * SIGN
 * =========================================================
 */

async function signTransaction(
  tronWeb,
  transaction
) {
  const signed =
    await tronWeb.trx.sign(
      transaction,
      getPrivateKey()
    );

  if (
    !signed ||
    !signed.txID
  ) {
    throw new Error(
      "TRON não retornou uma transação assinada válida."
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

  if (!result) {
    throw new Error(
      "TRON não retornou resultado do broadcast."
    );
  }

  if (
    result.result !== true
  ) {
    throw new Error(
      result.code ||
      result.message ||
      "A TRON rejeitou o broadcast."
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
  if (
    req.method !== "POST"
  ) {
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
     * CONFIG
     * =====================================================
     */

    if (
      !process.env.DATABASE_URL
    ) {
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

    if (
      !TRONGRID_API_KEY
    ) {
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

    if (
      !TRON_PRIVATE_KEY
    ) {
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

    const sql =
      neon(
        process.env.DATABASE_URL
      );

    const body =
      getBody(req);

    const withdrawalId =
      String(
        body.withdrawal_id ||
        ""
      ).trim();

    if (
      !withdrawalId
    ) {
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
     * BUSCAR RETIRADA
     * =====================================================
     */

    const rows =
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
        WHERE withdrawal_id =
          ${withdrawalId}
          AND user_id =
          ${USER_ID}
        LIMIT 1
      `;


    if (
      rows.length === 0
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
      rows[0];


    const status =
      String(
        withdrawal.status ||
        ""
      ).toUpperCase();


    /*
     * =====================================================
     * COMPLETED
     * =====================================================
     */

    if (
      status === "COMPLETED"
    ) {
      return json(
        res,
        200,
        {
          success: true,

          already_completed:
            true,

          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status,

            tx_hash:
              withdrawal.tx_hash ||
              null
          }
        }
      );
    }


    /*
     * =====================================================
     * PROCESSING COM TX
     * =====================================================
     */

    if (
      status === "PROCESSING" &&
      withdrawal.tx_hash
    ) {
      return json(
        res,
        200,
        {
          success: true,

          already_broadcast:
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


    /*
     * =====================================================
     * PROCESSING SEM TX
     * =====================================================
     */

    if (
      status === "PROCESSING" &&
      !withdrawal.tx_hash
    ) {
      return json(
        res,
        409,
        {
          success: false,

          error:
            "Esta retirada já está em processamento. Não será transmitida novamente."
        }
      );
    }


    /*
     * =====================================================
     * AUTORIZAÇÃO
     * =====================================================
     */

    if (
      status !== "AUTHORIZED"
    ) {
      return json(
        res,
        409,
        {
          success: false,

          error:
            "A retirada precisa estar AUTHORIZED antes do processamento.",

          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status
          }
        }
      );
    }


    /*
     * =====================================================
     * ASSET
     * =====================================================
     */

    if (
      String(
        withdrawal.asset ||
        ""
      ).toUpperCase() !==
      ASSET
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Asset inválido. Esperado USDT."
        }
      );
    }


    /*
     * =====================================================
     * NETWORK
     * =====================================================
     */

    if (
      String(
        withdrawal.network ||
        ""
      ) !== NETWORK
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Network inválida. Esperado TRON Mainnet."
        }
      );
    }


    /*
     * =====================================================
     * DESTINO
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
     * VALOR
     * =====================================================
     */

    const rawAmount =
      parseUsdtAmount(
        withdrawal.amount_to_send
      );

    if (
      rawAmount === null
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
     * CARTEIRA MAINNET
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
        WHERE network =
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
      return json(
        res,
        404,
        {
          success: false,
          error:
            "Carteira USDT Mainnet não encontrada."
        }
      );
    }


    const sender =
      String(
        wallets[0].wallet_address ||
        ""
      ).trim();


    if (
      !isValidTronAddress(
        sender
      )
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "Carteira USDT Mainnet inválida."
        }
      );
    }


    /*
     * =====================================================
     * TRONWEB
     * =====================================================
     */

    const tronWeb =
      createTronWeb();


    /*
     * =====================================================
     * CONFIRMAR CHAVE
     * =====================================================
     */

    const serverAddress =
      getServerAddress(
        tronWeb
      );


    if (
      serverAddress !==
      sender
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRON_PRIVATE_KEY não corresponde à carteira Mainnet configurada."
        }
      );
    }


    /*
     * =====================================================
     * TRX
     * =====================================================
     */

    const account =
      await getAccount(
        sender
      );

    const trxSun =
      Number(
        account?.balance ||
        0
      );

    const trxBalance =
      trxSun /
      1_000_000;


    if (
      !Number.isFinite(
        trxBalance
      )
    ) {
      return json(
        res,
        502,
        {
          success: false,
          error:
            "Não foi possível consultar o saldo TRX."
        }
      );
    }


    /*
     * =====================================================
     * RESOURCES
     * =====================================================
     */

    const resources =
      await getAccountResources(
        sender
      );

    const energyLimit =
      Number(
        resources?.EnergyLimit ||
        0
      );

    const energyUsed =
      Number(
        resources?.EnergyUsed ||
        0
      );

    const energyAvailable =
      Math.max(
        0,
        energyLimit -
        energyUsed
      );

    const bandwidthLimit =
      Number(
        resources?.NetLimit ||
        0
      );

    const bandwidthUsed =
      Number(
        resources?.NetUsed ||
        0
      );

    const bandwidthAvailable =
      Math.max(
        0,
        bandwidthLimit -
        bandwidthUsed
      );


    /*
     * =====================================================
     * SALDO USDT REAL
     * =====================================================
     */

    const blockchainBalance =
      await getUsdtBalance(
        sender
      );


    if (
      blockchainBalance <
      rawAmount
    ) {
      return json(
        res,
        400,
        {
          success: false,

          error:
            "Saldo USDT real insuficiente na carteira TRON.",

          blockchain_balance:
            formatUsdtAmount(
              blockchainBalance
            ),

          requested:
            formatUsdtAmount(
              rawAmount
            )
        }
      );
    }


    /*
     * =====================================================
     * SIMULAÇÃO
     * =====================================================
     */

    const simulation =
      await simulateTransfer(
        tronWeb,
        sender,
        destination,
        rawAmount
      );


    if (
      simulation?.result?.result ===
      false
    ) {
      return json(
        res,
        400,
        {
          success: false,

          error:
            "A simulação da transferência TRC-20 falhou.",

          simulation: {
            code:
              simulation?.result?.code,

            message:
              simulation?.result?.message
          }
        }
      );
    }


    /*
     * =====================================================
     * CONSTRUIR
     * =====================================================
     */

    const transaction =
      await buildTransaction(
        tronWeb,
        sender,
        destination,
        rawAmount
      );


    /*
     * =====================================================
     * RESERVAR
     * =====================================================
     *
     * Somente uma execução pode assumir
     * AUTHORIZED → PROCESSING.
     *
     * Não usamos user_id do frontend.
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
          AND user_id =
            ${USER_ID}
          AND status =
            'AUTHORIZED'
          AND tx_hash IS NULL
        RETURNING
          withdrawal_id,
          status
      `;


    if (
      locked.length === 0
    ) {
      return json(
        res,
        409,
        {
          success: false,

          error:
            "A retirada já foi processada ou está sendo processada por outra execução."
        }
      );
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
        WHERE
          withdrawal_id =
            ${withdrawalId}
          AND user_id =
            ${USER_ID}
          AND status =
            'PROCESSING'
          AND tx_hash IS NULL
      `;

      throw error;
    }


    /*
     * =====================================================
     * TXID
     * =====================================================
     */

    const txID =
      String(
        signedTransaction.txID ||
        transaction.txID ||
        ""
      ).trim();


    if (!txID) {

      await sql`
        UPDATE withdrawals
        SET
          status = 'AUTHORIZED',
          updated_at = NOW()
        WHERE
          withdrawal_id =
            ${withdrawalId}
          AND user_id =
            ${USER_ID}
          AND status =
            'PROCESSING'
          AND tx_hash IS NULL
      `;

      throw new Error(
        "TXID não foi gerado."
      );
    }


    /*
     * =====================================================
     * BROADCAST
     * =====================================================
     */

    try {

      await broadcastTransaction(
        tronWeb,
        signedTransaction
      );

    } catch (error) {

      /*
       * NÃO voltamos para AUTHORIZED.
       *
       * O broadcast pode ter chegado à TRON
       * e a resposta pode ter sido perdida.
       *
       * Mantemos PROCESSING para evitar
       * uma possível transferência duplicada.
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

          broadcast_unknown:
            true,

          error:
            "Não foi possível confirmar a resposta do broadcast. A retirada permanece PROCESSING para evitar duplicação.",

          withdrawal_id:
            withdrawalId,

          txID
        }
      );
    }


    /*
     * =====================================================
     * GUARDAR TX HASH
     * =====================================================
     */

    const saved =
      await sql`
        UPDATE withdrawals
        SET
          tx_hash =
            ${txID},

          status =
            'PROCESSING',

          updated_at =
            NOW()

        WHERE
          withdrawal_id =
            ${withdrawalId}

          AND user_id =
            ${USER_ID}

          AND status =
            'PROCESSING'

          AND tx_hash IS NULL

        RETURNING
          withdrawal_id,
          status,
          tx_hash
      `;


    if (
      saved.length === 0
    ) {
      return json(
        res,
        200,
        {
          success: true,

          broadcasted: true,

          warning:
            "A transação foi transmitida, mas o estado da retirada mudou antes da gravação do TXID.",

          withdrawal_id:
            withdrawalId,

          txID
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
        success: true,

        broadcasted: true,

        signed: true,

        mode:
          "BROADCASTED",

        withdrawal_id:
          withdrawalId,

        user_id:
          USER_ID,

        sender,

        destination,

        asset:
          ASSET,

        network:
          NETWORK,

        standard:
          STANDARD,

        contract:
          USDT_CONTRACT,

        amount:
          formatUsdtAmount(
            rawAmount
          ),

        tx_hash:
          txID,

        status:
          "PROCESSING",

        blockchain: {
          usdt_balance_before:
            formatUsdtAmount(
              blockchainBalance
            ),

          trx_balance:
            trxBalance
        },

        resources: {
          energy_available:
            energyAvailable,

          bandwidth_available:
            bandwidthAvailable
        },

        validation: {
          authorized: true,

          destination_valid:
            true,

          network_valid:
            true,

          usdt_balance_ok:
            true,

          simulation_ok:
            true,

          wallet_matches_server_key:
            true
        },

        confirmation:
          "A transação foi transmitida para a TRON. A retirada permanece PROCESSING até confirmação on-chain."
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
          "Erro interno ao processar a retirada."
      }
    );
  }
}
