import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

/*
 * =========================================================
 * USDTMZ - M-PESA C2B
 * Compatível com a tabela orders existente
 * =========================================================
 *
 * ENVIRONMENT:
 *
 * MPESA_ENV=sandbox
 * ou
 * MPESA_ENV=production
 *
 * Variáveis necessárias:
 *
 * DATABASE_URL
 * MPESA_API_KEY
 * MPESA_PUBLIC_KEY
 * MPESA_SERVICE_PROVIDER_CODE
 * MPESA_ORIGIN
 *
 * =========================================================
 */

const MPESA_ENV =
  String(process.env.MPESA_ENV || "sandbox")
    .trim()
    .toLowerCase();

const IS_PRODUCTION =
  MPESA_ENV === "production" ||
  MPESA_ENV === "live";

const MPESA_HOST =
  IS_PRODUCTION
    ? "api.vm.co.mz"
    : "api.sandbox.vm.co.mz";

const MPESA_PORT = 18352;

const MPESA_PATH =
  "/ipg/v1x/c2bPayment/singleStage/";

const MPESA_ORIGIN =
  String(
    process.env.MPESA_ORIGIN ||
      "developer.mpesa.vm.co.mz"
  ).trim();

const SERVICE_PROVIDER_CODE =
  String(
    process.env.MPESA_SERVICE_PROVIDER_CODE ||
      ""
  ).trim();

const API_KEY =
  String(
    process.env.MPESA_API_KEY || ""
  ).trim();

const PUBLIC_KEY =
  String(
    process.env.MPESA_PUBLIC_KEY || ""
  ).trim();

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 1000000;

const REQUEST_TIMEOUT = 30000;


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
 * TELEFONE
 * =========================================================
 */

function normalizePhone(value) {

  let phone =
    String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/-/g, "");

  if (phone.startsWith("+")) {
    phone = phone.substring(1);
  }

  if (phone.startsWith("0")) {
    phone =
      "258" +
      phone.substring(1);
  }

  if (!/^258\d{9}$/.test(phone)) {
    return null;
  }

  return phone;
}


/*
 * =========================================================
 * REFERÊNCIA ALEATÓRIA
 * Máximo permitido: 20 caracteres
 * =========================================================
 */

function createThirdPartyReference() {

  const random =
    crypto
      .randomBytes(6)
      .toString("hex")
      .toUpperCase();

  const time =
    Date.now()
      .toString(36)
      .toUpperCase();

  return (
    "MZ" +
    time +
    random
  ).substring(0, 20);
}


/*
 * =========================================================
 * PUBLIC KEY
 * =========================================================
 */

function formatPublicKey(value) {

  let key =
    String(value || "")
      .trim();

  if (!key) {
    throw new Error(
      "MPESA_PUBLIC_KEY não configurada."
    );
  }

  /*
   * Caso já venha em PEM.
   */

  if (
    key.includes(
      "-----BEGIN PUBLIC KEY-----"
    )
  ) {
    return key;
  }

  /*
   * Caso o portal forneça somente
   * o conteúdo Base64.
   */

  key =
    key.replace(/\s+/g, "");

  return (
    "-----BEGIN PUBLIC KEY-----\n" +
    key +
    "\n-----END PUBLIC KEY-----"
  );
}


/*
 * =========================================================
 * GERAR BEARER TOKEN
 *
 * M-Pesa Mozambique:
 *
 * API Key
 *    ↓
 * RSA PKCS1
 *    ↓
 * Public Key
 *    ↓
 * Base64
 *    ↓
 * Bearer
 *
 * A API Key nunca é enviada diretamente
 * para o cliente.
 * =========================================================
 */

function generateBearerToken() {

  if (!API_KEY) {
    throw new Error(
      "MPESA_API_KEY não configurada."
    );
  }

  if (!PUBLIC_KEY) {
    throw new Error(
      "MPESA_PUBLIC_KEY não configurada."
    );
  }

  const publicKey =
    formatPublicKey(
      PUBLIC_KEY
    );

  const encrypted =
    crypto.publicEncrypt(
      {
        key: publicKey,

        padding:
          crypto.constants.RSA_PKCS1_PADDING
      },

      Buffer.from(
        API_KEY,
        "utf8"
      )
    );

  return encrypted.toString(
    "base64"
  );
}


/*
 * =========================================================
 * CHAMAR M-PESA
 * =========================================================
 */

async function callMpesa(payload) {

  const bearer =
    generateBearerToken();

  const url =
    `https://${MPESA_HOST}:${MPESA_PORT}${MPESA_PATH}`;

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

  try {

    const response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${bearer}`,

            "Origin":
              MPESA_ORIGIN,

            "Accept":
              "application/json"
          },

          body:
            JSON.stringify(payload),

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let data = {};

    if (text) {

      try {

        data =
          JSON.parse(text);

      } catch {

        data = {
          raw: text
        };

      }

    }

    return {
      httpStatus:
        response.status,

      data
    };

  } finally {

    clearTimeout(timer);

  }
}


/*
 * =========================================================
 * EXTRAIR CAMPO
 * =========================================================
 */

function firstValue(
  object,
  names
) {

  for (const name of names) {

    if (
      object &&
      object[name] !== undefined &&
      object[name] !== null
    ) {

      return String(
        object[name]
      ).trim();

    }

  }

  return "";

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
   * -------------------------------------------------------
   * SOMENTE POST
   * -------------------------------------------------------
   */

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
          "Método não permitido. Use POST."
      }
    );

  }


  try {

    /*
     * -----------------------------------------------------
     * CONFIGURAÇÃO
     * -----------------------------------------------------
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

    if (!API_KEY) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "MPESA_API_KEY não configurada."
        }
      );

    }

    if (!PUBLIC_KEY) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "MPESA_PUBLIC_KEY não configurada."
        }
      );

    }

    if (!SERVICE_PROVIDER_CODE) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "MPESA_SERVICE_PROVIDER_CODE não configurada."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * BODY
     * -----------------------------------------------------
     */

    const body =
      req.body || {};

    const orderId =
      String(
        body.order_id ||
        body.orderId ||
        ""
      ).trim();


    if (!orderId) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "order_id é obrigatório."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * BANCO
     * -----------------------------------------------------
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * Buscar pedido
     */

    const rows =
      await sql`

        SELECT

          id,
          order_id,
          name,
          phone,
          operation,
          payment,
          amount,
          usdt_amount,
          rate,
          status,
          mpesa_transaction_id,
          created_at,
          updated_at

        FROM orders

        WHERE order_id = ${orderId}

        LIMIT 1

      `;


    if (!rows.length) {

      return json(
        res,
        404,
        {
          success: false,
          error:
            "Pedido não encontrado."
        }
      );

    }


    const order =
      rows[0];


    /*
     * -----------------------------------------------------
     * PAGAMENTO TEM DE SER MPESA
     * -----------------------------------------------------
     */

    const payment =
      String(
        order.payment || ""
      )
        .trim()
        .toLowerCase();

    if (payment !== "mpesa") {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Este pedido não usa M-Pesa."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * NÃO PAGAR DUAS VEZES
     * -----------------------------------------------------
     */

    const currentStatus =
      String(
        order.status || ""
      )
        .trim()
        .toUpperCase();


    if (
      currentStatus === "PAID"
    ) {

      return json(
        res,
        409,
        {
          success: false,

          error:
            "Este pedido já está pago.",

          order: {
            order_id:
              order.order_id,

            status:
              currentStatus,

            mpesa_transaction_id:
              order.mpesa_transaction_id
          }
        }
      );

    }


    /*
     * Se já estiver PROCESSING,
     * não criamos outra cobrança.
     */

    if (
      currentStatus === "PROCESSING"
    ) {

      return json(
        res,
        409,
        {
          success: false,

          error:
            "Este pagamento já está em processamento.",

          order: {
            order_id:
              order.order_id,

            status:
              currentStatus,

            mpesa_transaction_id:
              order.mpesa_transaction_id
          }
        }
      );

    }


    /*
     * -----------------------------------------------------
     * OPERAÇÃO
     * -----------------------------------------------------
     */

    const operation =
      String(
        order.operation || ""
      )
        .trim()
        .toLowerCase();

    if (operation !== "buy") {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Operação inválida para pagamento M-Pesa."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * VALOR
     * -----------------------------------------------------
     */

    const amount =
      Number(order.amount);


    if (
      !Number.isFinite(amount) ||
      amount < MIN_AMOUNT ||
      amount > MAX_AMOUNT
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Valor da ordem inválido."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * TELEFONE
     * -----------------------------------------------------
     */

    const phone =
      normalizePhone(
        order.phone
      );


    if (!phone) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Número M-Pesa inválido."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * TRANSACTION REFERENCE
     *
     * Máximo: 20 caracteres
     * -----------------------------------------------------
     */

    const transactionReference =
      String(order.order_id)
        .replace(
          /[^A-Za-z0-9]/g,
          ""
        )
        .substring(0, 20);


    if (!transactionReference) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Não foi possível criar a referência da transação."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * THIRD PARTY REFERENCE
     * -----------------------------------------------------
     */

    const thirdPartyReference =
      createThirdPartyReference();


    /*
     * -----------------------------------------------------
     * PAYLOAD
     * -----------------------------------------------------
     */

    const payload = {

      input_TransactionReference:
        transactionReference,

      input_CustomerMSISDN:
        phone,

      input_Amount:
        String(amount),

      input_ThirdPartyReference:
        thirdPartyReference,

      input_ServiceProviderCode:
        SERVICE_PROVIDER_CODE

    };


    /*
     * -----------------------------------------------------
     * ENVIAR AO M-PESA
     *
     * Só mudamos o estado depois da resposta.
     * -----------------------------------------------------
     */

    const mpesa =
      await callMpesa(
        payload
      );


    const data =
      mpesa.data || {};


    /*
     * -----------------------------------------------------
     * RESPOSTA M-PESA
     * -----------------------------------------------------
     */

    const responseCode =
      firstValue(
        data,
        [
          "output_ResponseCode",
          "output_responseCode",
          "output_ResponseCode"
        ]
      );


    const responseDescription =
      firstValue(
        data,
        [
          "output_ResponseDesc",
          "output_ResponseDescription",
          "output_responseDesc"
        ]
      );


    const transactionId =
      firstValue(
        data,
        [
          "output_TransactionID",
          "output_TransactionId",
          "output_transactionID"
        ]
      );


    const conversationId =
      firstValue(
        data,
        [
          "output_ConversationID",
          "output_ConversationId",
          "output_conversationID"
        ]
      );


    /*
     * -----------------------------------------------------
     * INS-0
     * -----------------------------------------------------
     *
     * O pedido foi aceito/processado pela API.
     *
     * Não transformamos automaticamente em PAID
     * apenas por receber INS-0, porque a documentação
     * também suporta fluxo assíncrono.
     * -----------------------------------------------------
     */

    if (
      mpesa.httpStatus >= 200 &&
      mpesa.httpStatus < 300 &&
      responseCode === "INS-0"
    ) {

      const savedTransactionId =
        transactionId ||
        thirdPartyReference;


      await sql`

        UPDATE orders

        SET

          status = 'PROCESSING',

          mpesa_transaction_id =
            ${savedTransactionId},

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          order_id = ${orderId}

      `;


      return json(
        res,
        200,
        {

          success: true,

          message:
            "Pagamento M-Pesa iniciado. Aguardando confirmação.",

          environment:
            IS_PRODUCTION
              ? "production"
              : "sandbox",

          order: {

            id:
              order.id,

            order_id:
              order.order_id,

            status:
              "PROCESSING",

            amount:
              Number(order.amount),

            usdt_amount:
              Number(order.usdt_amount)
                .toFixed(6),

            mpesa_transaction_id:
              savedTransactionId,

            conversation_id:
              conversationId || null,

            third_party_reference:
              thirdPartyReference

          }

        }
      );

    }


    /*
     * -----------------------------------------------------
     * FALHA
     * -----------------------------------------------------
     */

    await sql`

      UPDATE orders

      SET

        status = 'FAILED',

        updated_at =
          CURRENT_TIMESTAMP

      WHERE
        order_id = ${orderId}

    `;


    /*
     * -----------------------------------------------------
     * MAPEAR STATUS HTTP
     * -----------------------------------------------------
     */

    let statusCode =
      Number(
        mpesa.httpStatus
      );


    if (
      !Number.isInteger(statusCode) ||
      statusCode < 400 ||
      statusCode > 599
    ) {

      statusCode = 400;

    }


    /*
     * -----------------------------------------------------
     * RESPOSTA DE ERRO
     * -----------------------------------------------------
     */

    return json(
      res,
      statusCode,
      {

        success: false,

        error:
          responseDescription ||
          "O M-Pesa não aceitou o pagamento.",

        code:
          responseCode ||
          null,

        order: {

          order_id:
            order.order_id,

          status:
            "FAILED"

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ MPESA ERROR:",
      error?.message ||
      error
    );


    /*
     * Nunca enviamos API Key,
     * Public Key, Bearer ou detalhes
     * internos para o navegador.
     */

    return json(
      res,
      500,
      {

        success: false,

        error:
          "Erro interno ao processar o pagamento M-Pesa."

      }
    );

  }

}
