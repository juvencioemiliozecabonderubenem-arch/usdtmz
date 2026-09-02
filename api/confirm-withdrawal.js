// /api/confirm-withdrawal.js
//
// USDTMZ — CONFIRMAÇÃO DE SAQUE
// TRON MAINNET / USDT TRC-20
//
// FLUXO:
// PROCESSING
//    ↓
// verifica TX na TRON
//    ↓
// verifica confirmação solidificada
//    ↓
// verifica evento Transfer do USDT
//    ↓
// COMPLETED
//    ↓
// desconta saldo interno do owner
//    ↓
// registra wallet_transactions
//
// IMPORTANTE:
// - Não recebe chave privada pelo navegador.
// - Não envia chave privada para o cliente.
// - A carteira usada no registro é wallet_id = 4.
// - O utilizador interno atual é "owner".

import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

const sql = neon(process.env.DATABASE_URL);

const USER_ID = "owner";
const WALLET_ID = 4;

const TRON_HOST =
  process.env.TRON_HOST || "https://api.trongrid.io";

const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY;

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";
const DECIMALS = 6;

function json(res, status, data) {
  res.status(status).json(data);
}

function isValidTronAddress(address) {
  return (
    typeof address === "string" &&
    /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
  );
}

function parseUsdtAmount(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, fraction = ""] = text.split(".");

  const padded = fraction.padEnd(DECIMALS, "0");

  try {
    return (
      BigInt(whole) * 1000000n +
      BigInt(padded)
    );
  } catch {
    return null;
  }
}

function formatUsdtAmount(raw) {
  const value = BigInt(raw);

  const whole = value / 1000000n;
  const fraction = (value % 1000000n)
    .toString()
    .padStart(6, "0");

  return `${whole}.${fraction}`;
}

function normalizeHexAddress(value) {
  if (!value) return null;

  let text = String(value).trim();

  if (text.startsWith("0x")) {
    text = text.slice(2);
  }

  if (text.length === 40) {
    text = "41" + text;
  }

  if (!/^41[0-9a-fA-F]{40}$/.test(text)) {
    return null;
  }

  return text.toUpperCase();
}

function base58CheckEncode(hex) {
  const payload = Buffer.from(hex, "hex");

  const hash1 = crypto
    .createHash("sha256")
    .update(payload)
    .digest();

  const hash2 = crypto
    .createHash("sha256")
    .update(hash1)
    .digest();

  const checksum = hash2.subarray(0, 4);

  const data = Buffer.concat([
    payload,
    checksum,
  ]);

  let num = BigInt("0x" + data.toString("hex"));

  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let result = "";

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result = alphabet[remainder] + result;
  }

  for (const byte of data) {
    if (byte === 0) {
      result = "1" + result;
    } else {
      break;
    }
  }

  return result;
}

function tronHexToBase58(value) {
  const normalized = normalizeHexAddress(value);

  if (!normalized) {
    return null;
  }

  return base58CheckEncode(normalized);
}

function normalizeEventAddress(value) {
  if (!value) return null;

  const text = String(value).trim();

  if (text.startsWith("T")) {
    return text;
  }

  return tronHexToBase58(text);
}

function extractEventValue(event) {
  const raw =
    event?.result?.value ??
    event?.result?._value ??
    event?.result?.amount ??
    event?.result?.["_value"];

  if (
    raw === undefined ||
    raw === null
  ) {
    return null;
  }

  try {
    return BigInt(String(raw));
  } catch {
    return null;
  }
}

async function tronRequest(path, options = {}) {
  const response = await fetch(
    `${TRON_HOST}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "TRON-PRO-API-KEY":
          TRONGRID_API_KEY,
        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    const error = new Error(
      `TRON HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function getTransactionInfo(txHash) {
  return tronRequest(
    `/wallet/gettransactioninfobyid?value=${encodeURIComponent(
      txHash
    )}`
  );
}

async function getSolidifiedTransactionInfo(txHash) {
  return tronRequest(
    `/walletsolidity/gettransactioninfobyid?value=${encodeURIComponent(
      txHash
    )}`
  );
}

async function getTransaction(txHash) {
  return tronRequest(
    `/wallet/gettransactionbyid?value=${encodeURIComponent(
      txHash
    )}`
  );
}

async function getConfirmedTransferEvents(txHash) {
  return tronRequest(
    `/v1/transactions/${encodeURIComponent(
      txHash
    )}/events?only_confirmed=true&limit=200`
  );
}

function transactionFailed(info) {
  const result =
    info?.receipt?.result ??
    info?.result;

  if (!result) {
    return false;
  }

  const normalized = String(result).toUpperCase();

  return [
    "FAILED",
    "REVERT",
    "OUT_OF_ENERGY",
    "OUT_OF_TIME",
    "OUT_OF_BANDWIDTH",
    "ERROR",
  ].includes(normalized);
}

function findUsdtTransferEvent(
  events,
  destinationAddress,
  expectedRawAmount
) {
  const list =
    Array.isArray(events?.data)
      ? events.data
      : [];

  const expectedDestination =
    destinationAddress.trim();

  for (const event of list) {
    if (
      String(event?.event_name || "")
        .toLowerCase() !== "transfer"
    ) {
      continue;
    }

    const contract =
      event?.contract_address;

    if (
      contract &&
      contract !== USDT_CONTRACT
    ) {
      continue;
    }

    const result = event?.result || {};

    const from =
      normalizeEventAddress(result.from);

    const to =
      normalizeEventAddress(result.to);

    const value =
      extractEventValue(event);

    if (!to || !value) {
      continue;
    }

    if (to !== expectedDestination) {
      continue;
    }

    if (value !== expectedRawAmount) {
      continue;
    }

    return {
      from,
      to,
      value,
      event,
    };
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido.",
    });
  }

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error: "DATABASE_URL não configurada.",
    });
  }

  if (!TRONGRID_API_KEY) {
    return json(res, 500, {
      success: false,
      error: "TRONGRID_API_KEY não configurada.",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const withdrawalId =
      body.withdrawal_id;

    if (
      !withdrawalId ||
      typeof withdrawalId !== "string"
    ) {
      return json(res, 400, {
        success: false,
        error:
          "withdrawal_id é obrigatório.",
      });
    }

    /*
     * Buscar o saque.
     *
     * Não usamos colunas que não existem.
     */
    const withdrawals = await sql`
      SELECT
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash,
        created_at,
        updated_at,
        order_id,
        amount_requested,
        withdrawal_fee,
        amount_to_send
      FROM withdrawals
      WHERE withdrawal_id = ${withdrawalId}
        AND user_id = ${USER_ID}
      LIMIT 1
    `;

    if (withdrawals.length === 0) {
      return json(res, 404, {
        success: false,
        error: "Saque não encontrado.",
      });
    }

    const withdrawal =
      withdrawals[0];

    /*
     * Se já estiver COMPLETED,
     * não processar novamente.
     */
    if (
      withdrawal.status ===
      "COMPLETED"
    ) {
      return json(res, 200, {
        success: true,
        already_completed: true,
        withdrawal_id:
          withdrawal.withdrawal_id,
        status: "COMPLETED",
        tx_hash: withdrawal.tx_hash,
      });
    }

    if (
      withdrawal.status !==
      "PROCESSING"
    ) {
      return json(res, 409, {
        success: false,
        error:
          `O saque está em estado "${withdrawal.status}" e não pode ser confirmado.`,
      });
    }

    const txHash =
      String(
        withdrawal.tx_hash || ""
      ).trim();

    if (
      !/^[0-9a-fA-F]{64}$/.test(
        txHash
      )
    ) {
      return json(res, 400, {
        success: false,
        error:
          "tx_hash inválido ou ausente.",
      });
    }

    const destination =
      String(
        withdrawal.destination_address ||
          ""
      ).trim();

    if (!isValidTronAddress(destination)) {
      return json(res, 400, {
        success: false,
        error:
          "Endereço TRON de destino inválido.",
      });
    }

    if (
      withdrawal.asset !== ASSET
    ) {
      return json(res, 400, {
        success: false,
        error:
          "O ativo do saque não é USDT.",
      });
    }

    if (
      withdrawal.network !== NETWORK
    ) {
      return json(res, 400, {
        success: false,
        error:
          "A rede do saque não é TRON Mainnet.",
      });
    }

    /*
     * amount_to_send é a quantia que
     * realmente saiu da carteira.
     */
    const amountText =
      withdrawal.amount_to_send ??
      withdrawal.amount ??
      withdrawal.amount_requested;

    const expectedRawAmount =
      parseUsdtAmount(amountText);

    if (
      expectedRawAmount === null ||
      expectedRawAmount <= 0n
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Valor do saque inválido.",
      });
    }

    /*
     * 1. Verificar informação da transação.
     */
    const transactionInfo =
      await getTransactionInfo(
        txHash
      );

    if (
      !transactionInfo ||
      Object.keys(transactionInfo)
        .length === 0
    ) {
      return json(res, 202, {
        success: false,
        pending: true,
        error:
          "A transação ainda não foi indexada pela TRON.",
      });
    }

    if (
      transactionFailed(
        transactionInfo
      )
    ) {
      return json(res, 400, {
        success: false,
        error:
          "A transação TRON falhou.",
      });
    }

    /*
     * 2. Buscar transação original.
     */
    const transaction =
      await getTransaction(txHash);

    if (
      !transaction ||
      !transaction.txID
    ) {
      return json(res, 202, {
        success: false,
        pending: true,
        error:
          "Detalhes da transação ainda não disponíveis.",
      });
    }

    if (
      String(transaction.txID)
        .toLowerCase() !==
      txHash.toLowerCase()
    ) {
      return json(res, 400, {
        success: false,
        error:
          "O txID retornado pela TRON não corresponde ao tx_hash.",
      });
    }

    if (
      !Array.isArray(
        transaction.raw_data?.contract
      ) ||
      transaction.raw_data.contract.length ===
        0
    ) {
      return json(res, 400, {
        success: false,
        error:
          "A transação não contém contrato.",
      });
    }

    /*
     * 3. Verificar transação solidificada.
     */
    const solidified =
      await getSolidifiedTransactionInfo(
        txHash
      );

    if (
      !solidified ||
      Object.keys(solidified)
        .length === 0
    ) {
      return json(res, 202, {
        success: false,
        pending: true,
        error:
          "A transação ainda não está solidificada na TRON.",
      });
    }

    if (
      transactionFailed(solidified)
    ) {
      return json(res, 400, {
        success: false,
        error:
          "A transação solidificada indica falha.",
      });
    }

    /*
     * 4. Confirmar evento Transfer USDT.
     */
    const events =
      await getConfirmedTransferEvents(
        txHash
      );

    const transfer =
      findUsdtTransferEvent(
        events,
        destination,
        expectedRawAmount
      );

    if (!transfer) {
      return json(res, 202, {
        success: false,
        pending: true,
        error:
          "O evento Transfer confirmado do USDT ainda não foi encontrado.",
      });
    }

    /*
     * 5. Tudo confirmado.
     *
     * Agora fazemos a atualização interna.
     *
     * O saldo só será descontado se:
     * - o saque ainda estiver PROCESSING;
     * - o saldo tiver fundos suficientes.
     */
    const amountUsdt =
      formatUsdtAmount(
        expectedRawAmount
      );

    /*
     * Atualizar saldo e completar saque
     * numa única operação lógica.
     *
     * Primeiro tentamos descontar o saldo.
     */
    const balanceUpdate =
      await sql`
        UPDATE balances
        SET
          usdt_balance =
            usdt_balance - ${amountUsdt},
          updated_at = NOW()
        WHERE user_id = ${USER_ID}
          AND usdt_balance >= ${amountUsdt}
        RETURNING
          user_id,
          usdt_balance
      `;

    if (balanceUpdate.length === 0) {
      return json(res, 409, {
        success: false,
        error:
          "Saldo interno insuficiente para confirmar este saque.",
      });
    }

    const newBalance =
      balanceUpdate[0].usdt_balance;

    /*
     * Completar o saque.
     *
     * Se outra chamada já tiver completado,
     * não criamos uma segunda conclusão.
     */
    const completed =
      await sql`
        UPDATE withdrawals
        SET
          status = 'COMPLETED',
          tx_hash = ${txHash},
          updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
          AND user_id = ${USER_ID}
          AND status = 'PROCESSING'
          AND tx_hash = ${txHash}
        RETURNING
          withdrawal_id,
          status,
          tx_hash,
          destination_address,
          amount_requested,
          withdrawal_fee,
          amount_to_send,
          updated_at
      `;

    /*
     * Se o UPDATE não encontrou a linha,
     * precisamos devolver o saldo descontado.
     *
     * Isso protege contra chamadas concorrentes.
     */
    if (completed.length === 0) {
      await sql`
        UPDATE balances
        SET
          usdt_balance =
            usdt_balance + ${amountUsdt},
          updated_at = NOW()
        WHERE user_id = ${USER_ID}
      `;

      return json(res, 409, {
        success: false,
        error:
          "O saque mudou de estado durante a confirmação. O saldo foi restaurado.",
      });
    }

    /*
     * 6. Criar auditoria wallet_transactions.
     *
     * Não usamos wallet_id desconhecido:
     * a carteira confirmada no Neon é ID 4.
     */
    await sql`
      INSERT INTO wallet_transactions (
        wallet_id,
        order_id,
        tx_hash,
        type,
        asset,
        amount,
        network,
        status,
        created_at
      )
      VALUES (
        ${WALLET_ID},
        ${withdrawal.order_id || null},
        ${txHash},
        'WITHDRAWAL',
        ${ASSET},
        ${amountUsdt},
        ${NETWORK},
        'COMPLETED',
        NOW()
      )
    `;

    return json(res, 200, {
      success: true,
      message:
        "Saque confirmado com sucesso.",
      withdrawal: completed[0],
      transaction: {
        tx_hash: txHash,
        network: NETWORK,
        asset: ASSET,
        amount: amountUsdt,
        destination,
        from: transfer.from,
        to: transfer.to,
      },
      balance: {
        user_id: USER_ID,
        usdt_balance: newBalance,
      },
    });
  } catch (error) {
    console.error(
      "CONFIRM WITHDRAWAL ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao confirmar o saque.",
    });
  }
}
