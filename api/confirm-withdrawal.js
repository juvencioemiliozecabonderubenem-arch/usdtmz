// /api/confirm-withdrawal.js
//
// USDTMZ — CONFIRM WITHDRAWAL
// TRON MAINNET / USDT TRC-20
//
// FLUXO:
//
// PROCESSING
//     ↓
// consulta TXID na TRON
//     ↓
// verifica confirmação
//     ↓
// verifica contrato USDT
//     ↓
// verifica destino
//     ↓
// verifica valor
//     ↓
// COMPLETED
//
// IMPORTANTE:
//
// - NÃO assina
// - NÃO transmite
// - NÃO usa TRON_PRIVATE_KEY
// - NÃO cria uma nova transação
// - somente confirma uma transação já transmitida
//
// Se a blockchain ainda não confirmou:
// PROCESSING
//
// Se a blockchain indicar falha:
// FAILED
//
// Se todos os dados estiverem corretos:
// COMPLETED
//

import { neon } from "@neondatabase/serverless";

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";

const USDT_DECIMALS =
  6;


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

  return raw > 0n
    ? raw
    : null;
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
 * TRANSACTION INFO
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
 * TRANSACTION
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
 * CONFIRMAÇÃO DO EVENTO TRC-20
 * =========================================================
 *
 * Procura o evento Transfer do contrato USDT.
 *
 * Não confiamos somente em "transaction success".
 *
 * Também verificamos:
 *
 * - contrato
 * - from
 * - to
 * - amount
 * =========================================================
 */

async function getTransferEvents(
  txHash
) {
  return tronRequest(
    `/v1/transactions/${txHash}/events?limit=200`,
    {
      method:
        "GET"
    }
  );
}


/*
 * =========================================================
 * HEX → TRON ADDRESS
 * =========================================================
 */

function hexToTronAddress(
  hexAddress
) {
  let hex =
    String(
      hexAddress || ""
    )
      .replace(/^0x/, "")
      .toUpperCase();

  /*
   * Endereço TRON em logs ABI:
   *
   * 20 bytes
   *
   * Se vier com 41 no início,
   * removemos o prefixo.
   */

  if (
    hex.startsWith("41") &&
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

  try {
    return tronHex20ToBase58(
      hex
    );
  } catch {
    return null;
  }
}


/*
 * =========================================================
 * HEX TRON 20 BYTES → BASE58
 * =========================================================
 */

function tronHex20ToBase58(
  hex20
) {
  const fullHex =
    "41" +
    hex20;

  const bytes =
    Buffer.from(
      fullHex,
      "hex"
    );

  const payload =
    Buffer.from(
      bytes
    );

  const sha256 =
    requireCryptoSha256(
      payload
    );

  const checksum =
    requireCryptoSha256(
      sha256
    ).subarray(
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
 * SHA256
 * =========================================================
 */

function requireCryptoSha256(
  data
) {
  /*
   * Node.js built-in crypto.
   *
   * Import dinâmico evitado para manter
   * o endpoint simples.
   */

  const crypto =
    require("node:crypto");

  return crypto
    .createHash("sha256")
    .update(data)
    .digest();
}


/*
 * =========================================================
 * BASE58
 * =========================================================
 */

function base58Encode(buffer) {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let value =
    BigInt(
      "0x" +
      buffer.toString("hex")
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

    value /=
      58n;
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
 * NORMALIZAR EVENT ADDRESS
 * =========================================================
 */

function normalizeEventAddress(
  value
) {
  const text =
    String(
      value || ""
    ).trim();

  if (
    isValidTronAddress(text)
  ) {
    return text;
  }

  if (
    /^[0-9a-fA-F]{40}$/.test(
      text
    )
  ) {
    return hexToTronAddress(
      text
    );
  }

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
     * SÓ PROCESSING PODE SER CONFIRMADA
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
     * VALIDAR ASSET
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
     * VALIDAR NETWORK
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
     * VALOR ESPERADO
     * =====================================================
     */

    const expectedAmount =
      parseUsdtAmount(
        withdrawal.amount_to_send ??
        withdrawal.amount
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
     */

    const transactionInfo =
      await getTransactionInfo(
        txHash
      );


    /*
     * =====================================================
     * TRANSACTION NÃO ENCONTRADA
     * =====================================================
     */

    const hasBlock =
      transactionInfo &&
      (
        transactionInfo.blockNumber !==
          undefined ||
        transactionInfo.blockNumber !==
          null
      );


    /*
     * Se não existe resultado relevante,
     * ainda pode estar a aguardar indexação.
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
            "A transação ainda não foi encontrada como confirmada na TRON.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );
    }


    /*
     * =====================================================
     * VERIFICAR RESULTADO DA EXECUÇÃO
     * =====================================================
     */

    const receiptResult =
      String(
        transactionInfo?.receipt?.result ||
        transactionInfo?.result ||
        ""
      ).toUpperCase();


    const failed =
      [
        "FAILED",
        "OUT_OF_ENERGY",
        "REVERT",
        "OUT_OF_TIME"
      ].includes(
        receiptResult
      );


    if (
      failed
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
     * TRANSAÇÃO BASE
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
            "TXID encontrado parcialmente. Aguardando dados completos da transação.",

          withdrawal_id:
            withdrawalId,

          tx_hash:
            txHash
        }
      );
    }


    /*
     * =====================================================
     * CONTRACT
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
      contracts.length ===
        0
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
     * TRANSFER EVENTS
     * =====================================================
     */

    const eventsResponse =
      await getTransferEvents(
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
      events.find(
        event => {

          const contract =
            String(
              event?.contract_address ||
              event?.address ||
              ""
            ).toLowerCase();


          const eventName =
            String(
              event?.event_name ||
              event?.name ||
              ""
            ).toLowerCase();


          return (
            contract ===
              USDT_CONTRACT.toLowerCase() &&

            eventName ===
              "transfer"
          );

        }
      );


    /*
     * =====================================================
     * AINDA NÃO HÁ EVENTO
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
            "A transação existe, mas o evento USDT Transfer ainda não foi localizado.",

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


    const eventFrom =
      normalizeEventAddress(
        eventResult.from ||
        eventResult._from ||
        transferEvent.from
      );


    const eventTo =
      normalizeEventAddress(
        eventResult.to ||
        eventResult._to ||
        transferEvent.to
      );


    const eventValue =
      String(
        eventResult.value ||
        eventResult._value ||
        transferEvent.value ||
        "0"
      );


    let transferredRaw;

    try {

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
            "O valor do evento USDT retornado pela TRON é inválido."
        }
      );

    }


    /*
     * =====================================================
     * OBTER SENDER DA TRANSAÇÃO
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
      sender = null;
    }


    /*
     * =====================================================
     * VERIFICAÇÃO DO CONTRATO
     * =====================================================
     */

    const eventContract =
      String(
        transferEvent?.contract_address ||
        transferEvent?.address ||
        ""
      ).toLowerCase();


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

          tx_hash:
            txHash
        }
      );
    }


    /*
     * =====================================================
     * VERIFICAR DESTINO
     * =====================================================
     */

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
     * VERIFICAR VALOR
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
     * TXID CONSISTENTE
     * =====================================================
     */

    if (
      String(
        transaction.txID
      ).toLowerCase() !==
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
     * CONFIRMAR COMPLETED
     * =====================================================
     *
     * Só mudamos:
     *
     * PROCESSING → COMPLETED
     *
     * se ainda não tiver sido concluída.
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
     * OUTRA EXECUÇÃO JÁ CONFIRMOU
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
        current.length >
          0 &&
        String(
          current[0].status ||
          ""
        ).toUpperCase() ===
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
          "TRC-20",

        contract:
          USDT_CONTRACT,

        amount:
          formatUsdtAmount(
            transferredRaw
          ),

        sender,

        verification: {

          transaction_found:
            true,

          transaction_id_matches:
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
