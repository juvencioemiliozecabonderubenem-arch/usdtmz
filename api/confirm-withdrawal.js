// /api/confirm-withdrawal.js
//
// USDTMZ — CONFIRM WITHDRAWAL
// TRON MAINNET / USDT TRC-20
//
// ESTE ENDPOINT:
//
// - NÃO assina transações
// - NÃO transmite transações
// - NÃO usa TRON_PRIVATE_KEY
// - NÃO cria transações
// - somente CONFIRMA uma transação já transmitida
//
// FLUXO:
//
// PROCESSING
//      ↓
// consulta TXID
//      ↓
// verifica existência
//      ↓
// verifica execução
//      ↓
// verifica confirmação sólida
//      ↓
// verifica evento USDT Transfer
//      ↓
// verifica contrato USDT
//      ↓
// verifica destino
//      ↓
// verifica valor
//      ↓
// COMPLETED
//
// Se ainda não estiver confirmada:
// PROCESSING
//
// Se a execução falhou:
// FAILED
//
// Se todas as verificações forem válidas:
// COMPLETED
//

import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";


/*
 * =========================================================
 * CONFIGURAÇÃO
 * =========================================================
 */

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY ||
  "";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";

const STANDARD =
  "TRC-20";

const USDT_DECIMALS =
  6;


/*
 * =========================================================
 * JSON RESPONSE
 * =========================================================
 */

function json(
  res,
  status,
  data
) {
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

function isValidTronAddress(
  address
) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}


/*
 * =========================================================
 * USDT AMOUNT → RAW
 * =========================================================
 *
 * Exemplo:
 *
 * 2 USDT
 * =
 * 2000000
 *
 * 2.5 USDT
 * =
 * 2500000
 *
 * Máximo:
 * 6 casas decimais.
 *
 * =========================================================
 */

function parseUsdtAmount(
  value
) {
  const text =
    String(
      value ?? ""
    ).trim();

  if (
    !/^\d+(\.\d{1,6})?$/.test(
      text
    )
  ) {
    return null;
  }

  const parts =
    text.split(".");

  const whole =
    parts[0];

  const decimal =
    parts[1] || "";

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

    if (
      raw <= 0n
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
 * RAW → USDT
 * =========================================================
 */

function formatUsdtAmount(
  raw
) {
  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (
      value %
      1_000_000n
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
      JSON.parse(
        text
      );

  } catch {

    data = {
      raw:
        text
    };

  }


  if (
    !response.ok
  ) {

    throw new Error(
      `TRONGrid HTTP ${response.status}`
    );

  }


  return data;
}


/*
 * =========================================================
 * TRANSACTION INFO
 * =========================================================
 *
 * Retorna o receipt de execução.
 *
 * =========================================================
 */

async function getTransactionInfo(
  txHash
) {

  return tronRequest(
    "/wallet/gettransactioninfobyid",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          value:
            txHash
        })
    }
  );

}


/*
 * =========================================================
 * SOLIDIFIED TRANSACTION INFO
 * =========================================================
 *
 * walletsolidity:
 *
 * somente considera a transação depois
 * de estar solidificada.
 *
 * =========================================================
 */

async function getSolidifiedTransactionInfo(
  txHash
) {

  return tronRequest(
    "/walletsolidity/gettransactioninfobyid",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          value:
            txHash
        })
    }
  );

}


/*
 * =========================================================
 * TRANSACTION BODY
 * =========================================================
 */

async function getTransaction(
  txHash
) {

  return tronRequest(
    "/wallet/gettransactionbyid",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          value:
            txHash
        })
    }
  );

}


/*
 * =========================================================
 * USDT TRANSFER EVENTS
 * =========================================================
 *
 * Somente eventos CONFIRMADOS.
 *
 * =========================================================
 */

async function getConfirmedTransferEvents(
  txHash
) {

  return tronRequest(
    `/v1/transactions/${txHash}/events?only_confirmed=true&limit=200`,
    {
      method:
        "GET"
    }
  );

}


/*
 * =========================================================
 * SHA256
 * =========================================================
 */

function sha256(
  data
) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(data)
    .digest();

}


/*
 * =========================================================
 * BASE58 ENCODE
 * =========================================================
 */

function base58Encode(
  buffer
) {

  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";


  let value;


  if (
    buffer.length === 0
  ) {
    return "";
  }


  const hex =
    buffer.toString(
      "hex"
    );


  value =
    BigInt(
      `0x${hex}`
    );


  let result =
    "";


  while (
    value > 0n
  ) {

    const remainder =
      Number(
        value % 58n
      );

    result =
      alphabet[remainder] +
      result;

    value =
      value / 58n;

  }


  for (
    let i = 0;

    i < buffer.length &&
    buffer[i] === 0;

    i++
  ) {

    result =
      "1" +
      result;

  }


  return result;
}


/*
 * =========================================================
 * TRON HEX → BASE58
 * =========================================================
 */

function tronHex20ToBase58(
  hex20
) {

  const clean =
    String(
      hex20 || ""
    )
      .replace(
        /^0x/,
        ""
      )
      .toLowerCase();


  if (
    !/^[0-9a-f]{40}$/.test(
      clean
    )
  ) {
    return null;
  }


  const payload =
    Buffer.from(
      "41" + clean,
      "hex"
    );


  const firstHash =
    sha256(
      payload
    );


  const secondHash =
    sha256(
      firstHash
    );


  const checksum =
    secondHash.subarray(
      0,
      4
    );


  return base58Encode(
    Buffer.concat([
      payload,
      checksum
    ])
  );

}


/*
 * =========================================================
 * HEX ADDRESS → TRON ADDRESS
 * =========================================================
 */

function hexToTronAddress(
  hexAddress
) {

  let hex =
    String(
      hexAddress || ""
    )
      .trim()
      .replace(
        /^0x/,
        ""
      );


  if (
    hex.startsWith(
      "41"
    ) &&
    hex.length === 42
  ) {

    hex =
      hex.slice(2);

  }


  if (
    hex.length !== 40
  ) {

    return null;

  }


  return tronHex20ToBase58(
    hex
  );

}


/*
 * =========================================================
 * NORMALIZAR ENDEREÇO DO EVENTO
 * =========================================================
 */

function normalizeEventAddress(
  value
) {

  const text =
    String(
      value || ""
    ).trim();


  /*
   * Já é Base58 TRON
   */

  if (
    isValidTronAddress(
      text
    )
  ) {

    return text;

  }


  /*
   * Hex de 20 bytes
   */

  if (
    /^[0-9a-fA-F]{40}$/.test(
      text
    )
  ) {

    return hexToTronAddress(
      text
    );

  }


  /*
   * Hex TRON com prefixo 41
   */

  if (
    /^41[0-9a-fA-F]{40}$/.test(
      text
    )
  ) {

    return hexToTronAddress(
      text
    );

  }


  return null;
}


/*
 * =========================================================
 * OBTER VALOR DO EVENTO
 * =========================================================
 */

function getEventValue(
  event
) {

  const result =
    event?.result ||
    event?.event_data ||
    {};


  const candidates = [

    result.value,

    result._value,

    event?.value,

    event?.event_data?.value,

    event?.event_data?._value

  ];


  for (
    const candidate
    of candidates
  ) {

    if (
      candidate !==
      undefined &&
      candidate !==
      null &&
      String(
        candidate
      ).trim() !== ""
    ) {

      return String(
        candidate
      ).trim();

    }

  }


  return null;
}


/*
 * =========================================================
 * ENCONTRAR TRANSFER USDT
 * =========================================================
 */

function findUsdtTransferEvent(
  events
) {

  return events.find(
    event => {

      const contract =
        String(
          event?.contract_address ||
          event?.address ||
          ""
        ).trim().toLowerCase();


      const eventName =
        String(
          event?.event_name ||
          event?.name ||
          ""
        ).trim().toLowerCase();


      return (

        contract ===
          USDT_CONTRACT.toLowerCase()

        &&

        eventName ===
          "transfer"

      );

    }
  ) || null;

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

  /*
   * =======================================================
   * MÉTODO
   * =======================================================
   */

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
     * BUSCAR WITHDRAWAL
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
      rows.length === 0
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
      )
        .trim()
        .toUpperCase();


    /*
     * =====================================================
     * JÁ COMPLETED
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

          confirmed:
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
     * SOMENTE PROCESSING
     * =====================================================
     */

    if (
      status !==
      "PROCESSING"
    ) {

      return json(
        res,
        409,
        {
          success:
            false,

          error:
            "A retirada precisa estar PROCESSING para ser confirmada.",

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
     * TX HASH
     * =====================================================
     */

    const txHash =
      String(
        withdrawal.tx_hash ||
        ""
      ).trim();


    if (
      !/^[a-fA-F0-9]{64}$/.test(
        txHash
      )
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "TX hash inválido ou ainda não registrado."
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
            "Endereço de destino inválido."
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
      ).trim().toUpperCase()
      !==
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
      ).trim()
      !==
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
     * VALOR ESPERADO
     * =====================================================
     */

    const amountSource =
      withdrawal.amount_to_send ??
      withdrawal.amount;


    const expectedAmount =
      parseUsdtAmount(
        amountSource
      );


    if (
      expectedAmount ===
      null
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "Valor da retirada inválido."
        }
      );

    }


    /*
     * =====================================================
     * TRANSACTION INFO
     * =====================================================
     *
     * Primeiro verificamos se a transação existe
     * e se foi executada.
     *
     * =====================================================
     */

    const transactionInfo =
      await getTransactionInfo(
        txHash
      );


    /*
     * =====================================================
     * TX NÃO INDEXADA
     * =====================================================
     */

    if (
      !transactionInfo ||
      Object.keys(
        transactionInfo
      ).length === 0
    ) {

      return json(
        res,
        200,
        {
          success:
            true,

          confirmed:
            false,

          status:
            "PROCESSING",

          message:
            "A transação ainda não foi encontrada na TRON.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * RESULTADO DA EXECUÇÃO
     * =====================================================
     */

    const receiptResult =
      String(
        transactionInfo?.receipt?.result ||
        transactionInfo?.result ||
        ""
      )
        .trim()
        .toUpperCase();


    /*
     * =====================================================
     * EXECUÇÃO FALHOU
     * =====================================================
     */

    const failedResults = [

      "FAILED",

      "OUT_OF_ENERGY",

      "REVERT",

      "OUT_OF_TIME",

      "OUT_OF_TIME_ERROR"

    ];


    if (
      failedResults.includes(
        receiptResult
      )
    ) {

      await sql`

        UPDATE withdrawals

        SET

          status =
            'FAILED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'PROCESSING'

      `;


      return json(
        res,
        200,
        {
          success:
            false,

          confirmed:
            false,

          status:
            "FAILED",

          error:
            "A transação foi executada com falha na TRON.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash,

          tron_result:
            receiptResult

        }
      );

    }


    /*
     * =====================================================
     * TRANSACTION BODY
     * =====================================================
     */

    const transaction =
      await getTransaction(
        txHash
      );


    if (
      !transaction ||
      !transaction.txID
    ) {

      return json(
        res,
        200,
        {
          success:
            true,

          confirmed:
            false,

          status:
            "PROCESSING",

          message:
            "Aguardando dados completos da transação.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * TXID CONSISTENTE
     * =====================================================
     */

    if (
      String(
        transaction.txID
      ).toLowerCase()
      !==
      txHash.toLowerCase()
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "O TXID retornado pela TRON não corresponde ao TXID armazenado.",

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * CONTRATO DA TRANSAÇÃO
     * =====================================================
     */

    const contracts =
      transaction
        ?.raw_data
        ?.contract;


    if (
      !Array.isArray(
        contracts
      ) ||
      contracts.length === 0
    ) {

      return json(
        res,
        200,
        {
          success:
            true,

          confirmed:
            false,

          status:
            "PROCESSING",

          message:
            "Aguardando detalhes do contrato da transação.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * CONFIRMAÇÃO SOLIDIFICADA
     * =====================================================
     *
     * Não marcamos COMPLETED apenas porque
     * gettransactioninfobyid retornou.
     *
     * Também verificamos walletsolidity.
     *
     * =====================================================
     */

    const solidifiedInfo =
      await getSolidifiedTransactionInfo(
        txHash
      );


    if (
      !solidifiedInfo ||
      Object.keys(
        solidifiedInfo
      ).length === 0
    ) {

      return json(
        res,
        200,
        {
          success:
            true,

          confirmed:
            false,

          status:
            "PROCESSING",

          message:
            "A transação foi encontrada, mas ainda não está solidificada na TRON.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * RESULTADO SOLIDIFICADO
     * =====================================================
     */

    const solidifiedResult =
      String(
        solidifiedInfo?.receipt?.result ||
        solidifiedInfo?.result ||
        ""
      )
        .trim()
        .toUpperCase();


    if (
      failedResults.includes(
        solidifiedResult
      )
    ) {

      await sql`

        UPDATE withdrawals

        SET

          status =
            'FAILED',

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'PROCESSING'

      `;


      return json(
        res,
        200,
        {
          success:
            false,

          confirmed:
            false,

          status:
            "FAILED",

          error:
            "A transação solidificada indica falha.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash,

          tron_result:
            solidifiedResult
        }
      );

    }


    /*
     * =====================================================
     * TRANSFER EVENTS CONFIRMADOS
     * =====================================================
     */

    const eventsResponse =
      await getConfirmedTransferEvents(
        txHash
      );


    const events =
      Array.isArray(
        eventsResponse?.data
      )
        ? eventsResponse.data
        : [];


    /*
     * =====================================================
     * LOCALIZAR TRANSFER USDT
     * =====================================================
     */

    const transferEvent =
      findUsdtTransferEvent(
        events
      );


    /*
     * =====================================================
     * EVENTO AINDA NÃO ENCONTRADO
     * =====================================================
     */

    if (
      !transferEvent
    ) {

      return json(
        res,
        200,
        {
          success:
            true,

          confirmed:
            false,

          status:
            "PROCESSING",

          message:
            "A transação está solidificada, mas o evento USDT Transfer confirmado ainda não foi localizado.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * EVENT DATA
     * =====================================================
     */

    const eventResult =
      transferEvent?.result ||
      transferEvent?.event_data ||
      {};


    /*
     * =====================================================
     * FROM
     * =====================================================
     */

    const eventFrom =
      normalizeEventAddress(

        eventResult.from ||

        eventResult._from ||

        transferEvent.from ||

        transferEvent._from

      );


    /*
     * =====================================================
     * TO
     * =====================================================
     */

    const eventTo =
      normalizeEventAddress(

        eventResult.to ||

        eventResult._to ||

        transferEvent.to ||

        transferEvent._to

      );


    /*
     * =====================================================
     * VALUE
     * =====================================================
     */

    const eventValue =
      getEventValue(
        transferEvent
      );


    if (
      !eventValue
    ) {

      return json(
        res,
        502,
        {
          success:
            false,

          error:
            "O evento USDT não contém um valor válido.",

          tx_hash:
            txHash
        }
      );

    }


    let transferredRaw;


    try {

      /*
       * O TronGrid normalmente fornece
       * o valor do evento já decodificado
       * como string decimal.
       */

      if (
        !/^\d+$/.test(
          eventValue
        )
      ) {

        throw new Error(
          "invalid_event_value"
        );

      }


      transferredRaw =
        BigInt(
          eventValue
        );


    } catch {

      return json(
        res,
        502,
        {
          success:
            false,

          error:
            "O valor do evento USDT retornado pela TRON é inválido.",

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * CONTRATO DO EVENTO
     * =====================================================
     */

    const eventContract =
      String(
        transferEvent?.contract_address ||
        transferEvent?.address ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      eventContract !==
      USDT_CONTRACT.toLowerCase()
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "O evento confirmado não pertence ao contrato USDT esperado.",

          expected_contract:
            USDT_CONTRACT,

          blockchain_contract:
            transferEvent?.contract_address ||
            transferEvent?.address ||
            null,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * DESTINO
     * =====================================================
     */

    if (
      !eventTo
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "Não foi possível identificar o destino no evento USDT.",

          tx_hash:
            txHash
        }
      );

    }


    if (
      eventTo !==
      destination
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "O destino confirmado na blockchain não corresponde ao destino da retirada.",

          expected:
            destination,

          blockchain:
            eventTo,

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * VALOR
     * =====================================================
     */

    if (
      transferredRaw !==
      expectedAmount
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "O valor USDT confirmado na blockchain não corresponde ao valor da retirada.",

          expected:
            formatUsdtAmount(
              expectedAmount
            ),

          blockchain:
            formatUsdtAmount(
              transferredRaw
            ),

          tx_hash:
            txHash
        }
      );

    }


    /*
     * =====================================================
     * SENDER
     * =====================================================
     */

    let sender =
      null;


    try {

      const parameter =
        transaction
          ?.raw_data
          ?.contract?.[0]
          ?.parameter
          ?.value;


      if (
        parameter?.owner_address
      ) {

        sender =
          normalizeEventAddress(
            parameter.owner_address
          );

      }

    } catch {

      sender =
        null;

    }


    /*
     * =====================================================
     * VERIFICAR FROM DO EVENTO
     * =====================================================
     *
     * Não é obrigatório que seja igual ao
     * owner_address em todos os cenários de
     * smart contracts.
     *
     * Portanto usamos o from apenas como
     * informação de auditoria.
     *
     * =====================================================
     */


    /*
     * =====================================================
     * CONFIRMAR COMPLETED
     * =====================================================
     */

    const completed =
      await sql`

        UPDATE withdrawals

        SET

          status =
            'COMPLETED',

          tx_hash =
            ${txHash},

          updated_at =
            NOW()

        WHERE withdrawal_id =
          ${withdrawalId}

          AND status =
            'PROCESSING'

          AND tx_hash =
            ${txHash}

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
     * =====================================================
     * CONCORRÊNCIA
     * =====================================================
     */

    if (
      completed.length ===
      0
    ) {

      const current =
        await sql`

          SELECT

            withdrawal_id,

            status,

            tx_hash,

            updated_at

          FROM withdrawals

          WHERE withdrawal_id =
            ${withdrawalId}

          LIMIT 1

        `;


      if (
        current.length > 0 &&
        String(
          current[0].status ||
          ""
        )
          .toUpperCase()
          ===
          "COMPLETED"
      ) {

        return json(
          res,
          200,
          {
            success:
              true,

            confirmed:
              true,

            already_completed:
              true,

            withdrawal:
              current[0]
          }
        );

      }


      return json(
        res,
        409,
        {
          success:
            false,

          error:
            "A retirada mudou de estado antes da confirmação."
        }
      );

    }


    /*
     * =====================================================
     * SUCESSO FINAL
     * =====================================================
     */

    return json(
      res,
      200,
      {

        success:
          true,

        confirmed:
          true,

        status:
          "COMPLETED",

        withdrawal_id:
          withdrawalId,

        tx_hash:
          txHash,

        destination:
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
            transferredRaw
          ),

        sender:

          sender,

        event_from:

          eventFrom,

        verification: {

          transaction_found:
            true,

          transaction_id_matches:
            true,

          execution_success:
            true,

          solidified:
            true,

          confirmed_transfer_event:
            true,

          usdt_contract_matches:
            true,

          destination_matches:
            true,

          amount_matches:
            true,

          on_chain:
            true

        },

        message:
          "Retirada confirmada na TRON Mainnet e marcada como COMPLETED."

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ CONFIRM WITHDRAWAL ERROR:",
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
          "Erro interno ao confirmar a retirada.",

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
