// /api/process-withdrawal.js
//
// USDTMZ — PROCESS WITHDRAWAL
// TRON MAINNET / USDT TRC-20
//
// FLUXO:
//
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
//
// IMPORTANTE:
//
// - TRON_PRIVATE_KEY fica somente no servidor
// - nunca é enviada ao frontend
// - não usa TronLink
// - não abre site externo
// - não transmite uma retirada que não esteja AUTHORIZED
//
// Depois do broadcast:
// PROCESSING
//
// A confirmação final deve ser feita por uma rotina de
// confirmação blockchain antes de marcar COMPLETED.
//

import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const TRON_PRIVATE_KEY =
  process.env.TRON_PRIVATE_KEY || "";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";

const USDT_DECIMALS = 6;

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
        USDT_DECIMALS,
        "0"
      );

  return `${whole}.${decimal}`;
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

function getServerAddress(
  tronWeb
) {
  const address =
    tronWeb.address.fromPrivateKey(
      getPrivateKey()
    );

  if (
    !isValidTronAddress(address)
  ) {
    throw new Error(
      "A chave privada não corresponde a um endereço TRON válido."
    );
  }

  return address;
}


/*
 * =========================================================
 * ACCOUNT
 * =========================================================
 */

async function getAccount(
  address
) {
  return tronRequest(
    "/wallet/getaccount",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          address,
          visible: true
        })
    }
  );
}


/*
 * =========================================================
 * ACCOUNT RESOURCES
 * =========================================================
 */

async function getAccountResources(
  address
) {
  return tronRequest(
    "/wallet/getaccountresource",
    {
      method:
        "POST",

      body:
        JSON.stringify({
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

async function getUsdtBalance(
  address
) {
  const data =
    await tronRequest(
      `/v1/accounts/${address}/trc20/balance?contract_address=${USDT_CONTRACT}`,
      {
        method:
          "GET"
      }
    );

  const items =
    Array.isArray(data?.data)
      ? data.data
      : [];

  const token =
    items.find(
      item => {
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
      }
    );

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
 * ABI PARAMETER
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
      .padStart(
        64,
        "0"
      );

  const amountHex =
    rawAmount
      .toString(16)
      .padStart(
        64,
        "0"
      );

  return (
    addressHex +
    amountHex
  );
}


/*
 * =========================================================
 * SIMULAÇÃO
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
      method:
        "POST",

      body:
        JSON.stringify({
          owner_address:
            sender,

          contract_address:
            USDT_CONTRACT,

          function_selector:
            "transfer(address,uint256)",

          parameter,

          call_value:
            0,

          visible:
            true
        })
    }
  );
}


/*
 * =========================================================
 * CONSTRUIR TRANSAÇÃO
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
            type:
              "address",

            value:
              destination
          },

          {
            type:
              "uint256",

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
 * ASSINATURA
 * =========================================================
 *
 * A assinatura acontece no servidor.
 *
 * A chave privada NUNCA sai do ambiente do servidor.
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

  if (
    !result
  ) {
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
    req.method !==
    "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return json(
      res,
      405,
      {
        success:
          false,

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

    if (
      !process.env.DATABASE_URL
    ) {
      return json(
        res,
        500,
        {
          success:
            false,

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
          success:
            false,

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
          success:
            false,

          error:
            "TRON_PRIVATE_KEY não configurada."
        }
      );
    }


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
          success:
            false,

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

          id,

          withdrawal_id,

          destination_address,

          asset,

          network,

          amount,

          amount_requested,

          withdrawal_fee,

          amount_to_send,

          status,

          tx_hash,

          order_id,

          created_at,

          updated_at

        FROM withdrawals

        WHERE withdrawal_id =
          ${withdrawalId}

        LIMIT 1

      `;


    if (
      rows.length ===
      0
    ) {
      return json(
        res,
        404,
        {
          success:
            false,

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
     * JÁ COMPLETADA
     * =====================================================
     */

    if (
      status ===
      "COMPLETED"
    ) {
      return json(
        res,
        200,
        {
          success:
            true,

          already_completed:
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
     * JÁ PROCESSING COM TX
     * =====================================================
     */

    if (
      status ===
        "PROCESSING" &&
      withdrawal.tx_hash
    ) {
      return json(
        res,
        200,
        {
          success:
            true,

          already_broadcast:
            true,

          broadcasted:
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
     * NÃO REPETIR PROCESSAMENTO
     * =====================================================
     */

    if (
      status ===
        "PROCESSING" &&
      !withdrawal.tx_hash
    ) {
      return json(
        res,
        409,
        {
          success:
            false,

          error:
            "Esta retirada já está em processamento. Não será transmitida novamente automaticamente.",

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
     * AUTORIZAÇÃO
     * =====================================================
     */

    if (
      status !==
      "AUTHORIZED"
    ) {
      return json(
        res,
        409,
        {
          success:
            false,

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
          success:
            false,

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
      ) !==
      NETWORK
    ) {
      return json(
        res,
        400,
        {
          success:
            false,

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
          success:
            false,

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
        withdrawal.amount_to_send ??
        withdrawal.amount
      );


    if (
      rawAmount ===
      null
    ) {
      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "Valor USDT inválido."
        }
      );
    }


    /*
     * =====================================================
     * CARTEIRA CONFIGURADA
     * =====================================================
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
      wallets.length ===
      0
    ) {
      return json(
        res,
        404,
        {
          success:
            false,

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
          success:
            false,

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
     * CONFIRMAR CHAVE → CARTEIRA
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
          success:
            false,

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
          success:
            false,

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
          success:
            false,

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
          success:
            false,

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
     * RESERVAR RETIRADA
     * =====================================================
     *
     * Esta atualização acontece antes da assinatura.
     *
     * Apenas uma requisição pode mudar:
     *
     * AUTHORIZED → PROCESSING
     *
     * =====================================================
     */

    const locked =
      await sql`

        UPDATE withdrawals

        SET

          status =
            'PROCESSING',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'AUTHORIZED'

          AND tx_hash IS NULL

        RETURNING

          withdrawal_id,

          status

      `;


    if (
      locked.length ===
      0
    ) {
      return json(
        res,
        409,
        {
          success:
            false,

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

      /*
       * A assinatura falhou.
       *
       * Voltamos para AUTHORIZED para permitir
       * nova tentativa controlada.
       */

      await sql`

        UPDATE withdrawals

        SET

          status =
            'AUTHORIZED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

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

          status =
            'AUTHORIZED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

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
       * Se o broadcast chegar à TRON mas a resposta
       * se perder, não podemos simplesmente voltar
       * para AUTHORIZED e transmitir outra vez.
       *
       * Por segurança, mantemos PROCESSING.
       *
       * Uma rotina de confirmação deverá consultar
       * o txID e determinar se a transação entrou na rede.
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
          success:
            false,

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

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'PROCESSING'

          AND tx_hash IS NULL

        RETURNING

          withdrawal_id,

          status,

          tx_hash

      `;


    if (
      saved.length ===
      0
    ) {

      /*
       * A transação já foi transmitida.
       *
       * Não tentamos transmitir novamente.
       */

      return json(
        res,
        200,
        {
          success:
            true,

          broadcasted:
            true,

          warning:
            "A transação foi transmitida, mas o estado do banco mudou antes da gravação do TXID.",

          withdrawal_id:
            withdrawalId,

          txID
        }
      );
    }


    /*
     * =====================================================
     * RESPOSTA FINAL
     * =====================================================
     */

    return json(
      res,
      200,
      {

        success:
          true,

        broadcasted:
          true,

        signed:
          true,

        mode:
          "BROADCASTED",

        withdrawal_id:
          withdrawalId,

        sender,

        destination,

        asset:
          ASSET,

        network:
          NETWORK,

        standard:
          "TRC-20",

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

          authorized:
            true,

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
          "A transação foi transmitida para a TRON. A retirada deve permanecer PROCESSING até confirmação on-chain."

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

        success:
          false,

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
