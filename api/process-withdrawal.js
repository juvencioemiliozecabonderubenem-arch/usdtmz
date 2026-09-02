// /api/process-withdrawal.js
//
// USDTMZ — PROCESS WITHDRAWAL
// TRON MAINNET / USDT TRC-20
//
// PENDING
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
// broadcast
//    ↓
// PROCESSING
//    ↓
// confirm-withdrawal.js
//    ↓
// COMPLETED

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

const MAX_WITHDRAWAL_USDT = 1_000_000;

const FEE_LIMIT = Number(
  process.env.TRON_FEE_LIMIT ||
  100_000_000
);

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}

function getBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

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

  const [whole, decimal = ""] =
    text.split(".");

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

function createTronWeb() {
  return new TronWeb({
    fullHost: TRON_HOST,
    privateKey: getPrivateKey()
  });
}

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
    items.find((item) => {
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
        token.balance || "0"
      )
    );
  } catch {
    return 0n;
  }
}

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
          feeLimit: FEE_LIMIT,
          callValue: 0
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
    if (!process.env.DATABASE_URL) {
      return json(res, 500, {
        success: false,
        error:
          "DATABASE_URL não configurada."
      });
    }

    if (!TRONGRID_API_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "TRONGRID_API_KEY não configurada."
      });
    }

    if (!TRON_PRIVATE_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "TRON_PRIVATE_KEY não configurada."
      });
    }

    const sql =
      neon(
        process.env.DATABASE_URL
      );

    const body =
      getBody(req);

    const withdrawalId =
      String(
        body.withdrawal_id || ""
      ).trim();

    if (!withdrawalId) {
      return json(res, 400, {
        success: false,
        error:
          "withdrawal_id é obrigatório."
      });
    }

    /*
     * IMPORTANTE:
     * A tabela real possui "amount".
     * Também mantemos amount_to_send como
     * fallback para registros antigos.
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
          amount_to_send,
          status,
          tx_hash,
          order_id,
          amount_requested,
          withdrawal_fee,
          created_at,
          updated_at
        FROM withdrawals
        WHERE withdrawal_id =
          ${withdrawalId}
        LIMIT 1
      `;

    if (rows.length === 0) {
      return json(res, 404, {
        success: false,
        error:
          "Retirada não encontrada."
      });
    }

    const withdrawal =
      rows[0];

    const status =
      String(
        withdrawal.status || ""
      ).toUpperCase();

    /*
     * Nunca transmitir novamente uma
     * retirada que já possui TXID.
     */
    if (
      status === "PROCESSING" &&
      withdrawal.tx_hash
    ) {
      return json(res, 200, {
        success: true,
        already_broadcast: true,
        withdrawal_id:
          withdrawal.withdrawal_id,
        status:
          withdrawal.status,
        tx_hash:
          withdrawal.tx_hash
      });
    }

    if (status === "COMPLETED") {
      return json(res, 200, {
        success: true,
        already_completed: true,
        withdrawal_id:
          withdrawal.withdrawal_id,
        status:
          withdrawal.status,
        tx_hash:
          withdrawal.tx_hash
      });
    }

    /*
     * Uma retirada PENDING ainda precisa
     * de autorização administrativa.
     */
    if (status !== "AUTHORIZED") {
      return json(res, 409, {
        success: false,
        error:
          "A retirada precisa estar AUTHORIZED antes do processamento.",
        withdrawal: {
          withdrawal_id:
            withdrawal.withdrawal_id,
          status:
            withdrawal.status
        }
      });
    }

    if (
      String(
        withdrawal.asset || ""
      ).toUpperCase() !== ASSET
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Asset inválido. Esperado USDT."
      });
    }

    if (
      String(
        withdrawal.network || ""
      ) !== NETWORK
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Network inválida. Esperado TRON Mainnet."
      });
    }

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
      return json(res, 400, {
        success: false,
        error:
          "Endereço TRON de destino inválido."
      });
    }

    /*
     * CORREÇÃO PRINCIPAL:
     *
     * O seu banco tem:
     *
     * amount = 66.000000
     *
     * Portanto usamos "amount" primeiro.
     *
     * amount_to_send fica apenas como
     * fallback para compatibilidade.
     */
    const amountValue =
      withdrawal.amount ??
      withdrawal.amount_to_send;

    const rawAmount =
      parseUsdtAmount(
        amountValue
      );

    if (rawAmount === null) {
      return json(res, 400, {
        success: false,
        error:
          "Valor USDT inválido ou ausente na retirada.",
        amount:
          amountValue
      });
    }

    const tronWeb =
      createTronWeb();

    const serverAddress =
      getServerAddress(
        tronWeb
      );

    /*
     * Buscar carteira registrada.
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

    if (wallets.length === 0) {
      return json(res, 404, {
        success: false,
        error:
          "Carteira USDT Mainnet não encontrada."
      });
    }

    const wallet =
      wallets[0];

    const sender =
      String(
        wallet.wallet_address || ""
      ).trim();

    if (
      !isValidTronAddress(
        sender
      )
    ) {
      return json(res, 500, {
        success: false,
        error:
          "Carteira TRON Mainnet inválida."
      });
    }

    /*
     * A chave privada do servidor precisa
     * corresponder à carteira ID 4.
     */
    if (
      serverAddress !== sender
    ) {
      return json(res, 500, {
        success: false,
        error:
          "TRON_PRIVATE_KEY não corresponde à carteira Mainnet configurada."
      });
    }

    /*
     * Saldo TRX.
     */
    const account =
      await getAccount(
        sender
      );

    const trxSun =
      Number(
        account?.balance || 0
      );

    const trxBalance =
      trxSun / 1_000_000;

    if (
      !Number.isFinite(
        trxBalance
      )
    ) {
      return json(res, 502, {
        success: false,
        error:
          "Não foi possível consultar o saldo TRX."
      });
    }

    /*
     * Recursos.
     */
    const resources =
      await getAccountResources(
        sender
      );

    const energyLimit =
      Number(
        resources?.EnergyLimit || 0
      );

    const energyUsed =
      Number(
        resources?.EnergyUsed || 0
      );

    const energyAvailable =
      Math.max(
        0,
        energyLimit - energyUsed
      );

    const bandwidthLimit =
      Number(
        resources?.NetLimit || 0
      );

    const bandwidthUsed =
      Number(
        resources?.NetUsed || 0
      );

    const bandwidthAvailable =
      Math.max(
        0,
        bandwidthLimit - bandwidthUsed
      );

    /*
     * Saldo USDT real.
     */
    const blockchainBalance =
      await getUsdtBalance(
        sender
      );

    if (
      blockchainBalance <
      rawAmount
    ) {
      return json(res, 400, {
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
      });
    }

    /*
     * Simulação.
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
      return json(res, 400, {
        success: false,

        error:
          "A simulação da transferência TRC-20 falhou.",

        simulation: {
          code:
            simulation?.result?.code,

          message:
            simulation?.result?.message
        }
      });
    }

    /*
     * Construir transação.
     */
    const transaction =
      await buildTransaction(
        tronWeb,
        sender,
        destination,
        rawAmount
      );

    /*
     * Reservar a retirada.
     *
     * Somente AUTHORIZED pode entrar
     * em PROCESSING.
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

    if (locked.length === 0) {
      return json(res, 409, {
        success: false,
        error:
          "A retirada já foi processada ou está sendo processada."
      });
    }

    /*
     * Assinar.
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
     * Broadcast.
     *
     * Se houver dúvida sobre a resposta,
     * NÃO repetimos o envio.
     */
    try {
      await broadcastTransaction(
        tronWeb,
        signedTransaction
      );
    } catch (error) {
      console.error(
        "USDTMZ BROADCAST ERROR:",
        error?.message || error
      );

      return json(res, 502, {
        success: false,

        broadcast_unknown:
          true,

        error:
          "Não foi possível confirmar a resposta do broadcast. A retirada permanece PROCESSING para evitar duplicação.",

        withdrawal_id:
          withdrawalId,

        txID
      });
    }

    /*
     * Guardar TXID.
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

    if (saved.length === 0) {
      return json(res, 200, {
        success: true,

        broadcasted: true,

        warning:
          "A transação foi transmitida, mas o TXID não pôde ser associado à retirada.",

        withdrawal_id:
          withdrawalId,

        txID
      });
    }

    return json(res, 200, {
      success: true,

      broadcasted: true,

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
        "Transação transmitida. A retirada permanece PROCESSING até confirmação on-chain."
    });

  } catch (error) {
    console.error(
      "USDTMZ PROCESS WITHDRAWAL ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao processar a retirada."
    });
  }
}
