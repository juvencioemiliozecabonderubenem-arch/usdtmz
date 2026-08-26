import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

const MPESA_ENV =
  String(process.env.MPESA_ENV || "sandbox")
    .trim()
    .toLowerCase();

const MPESA_HOST =
  MPESA_ENV === "production"
    ? "api.vm.co.mz"
    : "api.sandbox.vm.co.mz";

const MPESA_PORT =
  MPESA_ENV === "production"
    ? 18352
    : 18352;

const MPESA_PATH =
  "/ipg/v1x/c2bPayment/singleStage/";

const MPESA_ORIGIN =
  process.env.MPESA_ORIGIN ||
  "developer.mpesa.vm.co.mz";

const SERVICE_PROVIDER_CODE =
  String(
    process.env.MPESA_SERVICE_PROVIDER_CODE || ""
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


/*
 * =========================================================
 * RESPOSTA JSON
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
 * NORMALIZAR TELEFONE
 * =========================================================
 */

function normalizePhone(value) {

  let phone =
    String(value || "")
      .trim()
      .replace(/\s+/g, "");

  if (phone.startsWith("+")) {
    phone = phone.substring(1);
  }

  if (phone.startsWith("0")) {
    phone = "258" + phone.substring(1);
  }

  if (!/^258\d{9}$/.test(phone)) {
    return null;
  }

  return phone;
}


/*
 * =========================================================
 * REFERÊNCIAS
 * =========================================================
 */

function createReference(prefix = "USDTMZ") {

  const random =
    crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

  const time =
    Date.now()
      .toString(36)
      .toUpperCase();

  return `${prefix}-${time}-${random}`;
}


/*
 * =========================================================
 * TOKEN M-PESA
 *
 * O portal utiliza API Key + Public Key.
 * O Bearer não deve ser colocado manualmente no código.
 *
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

  let key = PUBLIC_KEY.trim();

  /*
   * Aceita a chave com ou sem os marcadores PEM.
   */

  if (!key.includes("BEGIN PUBLIC KEY")) {

    key =
      `-----BEGIN PUBLIC KEY-----\n` +
      key.replace(/\s+/g, "") +
      `\n-----END PUBLIC KEY-----`;

  }

  /*
   * RSA-OAEP com SHA-1 é usado pelo SDK
   * compatível com o portal M-Pesa.
   */

  const encrypted =
    crypto.publicEncrypt(
      {
        key,

        padding:
          crypto.constants.RSA_PKCS1_OAEP_PADDING,

        oaepHash: "sha1"

      },

      Buffer.from(API_KEY, "utf8")
    );

  return encrypted.toString("base64");
}


/*
 * =========================================================
 * CHAMADA M-PESA
 * =========================================================
 */

async function callMpesa(payload) {

  const bearer =
    generateBearerToken();

  const url =
    `https://${MPESA_HOST}:${MPESA_PORT}${MPESA_PATH}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      30000
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
              MPESA_ORIGIN

          },

          body:
            JSON.stringify(payload),

          signal:
            controller.signal

        }
      );

    const text =
      await response.text();

    let data;

    try {
      data =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      data = {
        raw: text
      };
    }

    return {
      httpStatus:
        response.status,

      data
    };

  } finally {

    clearTimeout(timeout);

  }

}


/*
 * =========================================================
 * HANDLER
 * =========================================================
 */

export default async function handler(req, res) {

  if (req.method !== "POST") {

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
     * =====================================================
     * BODY
     * =====================================================
     */

    const body =
      req.body || {};

    const orderId =
      String(
        body.order_id ||
        body.orderId ||
        ""
      ).trim();


    /*
     * =====================================================
     * ORDER_ID OBRIGATÓRIO
     * =====================================================
     *
     * O frontend não deve mandar valor diferente
     * da ordem existente.
     *
     */

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
     * =====================================================
     * BANCO
     * =====================================================
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * Buscar ordem existente.
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
     * =====================================================
     * VALIDAR MÉTODO DE PAGAMENTO
     * =====================================================
     */

    if (
      String(order.payment || "")
        .toLowerCase() !== "mpesa"
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Este pedido não é um pagamento M-Pesa."
        }
      );

    }


    /*
     * =====================================================
     * NÃO REPETIR PAGAMENTO
     * =====================================================
     */

    if (
      String(order.status || "")
        .toUpperCase() === "PAID"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido já foi pago.",
          order: {
            order_id:
              order.order_id,

            status:
              order.status,

            mpesa_transaction_id:
              order.mpesa_transaction_id
          }
        }
      );

    }


    /*
     * =====================================================
     * VALIDAR VALOR
     * =====================================================
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
     * =====================================================
     * TELEFONE
     * =====================================================
     */

    const phone =
      normalizePhone(order.phone);

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
     * =====================================================
     * REFERÊNCIAS
     * =====================================================
     */

    /*
     * TransactionReference:
     * máximo de 20 caracteres segundo
     * a documentação fornecida.
     */

    const transactionReference =
      String(order.order_id)
        .replace(/[^A-Za-z0-9]/g, "")
        .substring(0, 20);

    const thirdPartyReference =
      createReference("MZ")
        .replace(/[^A-Za-z0-9]/g, "")
        .substring(0, 20);


    /*
     * =====================================================
     * MARCAR COMO PROCESSING
     * =====================================================
     *
     * Não marcamos PAID aqui.
     */

    await sql`

      UPDATE orders

      SET

        status = 'PROCESSING',

        updated_at = CURRENT_TIMESTAMP

      WHERE

        order_id = ${orderId}

        AND status = 'PENDING'

    `;


    /*
     * =====================================================
     * PAYLOAD M-PESA
     * =====================================================
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
     * =====================================================
     * ENVIAR PARA M-PESA
     * =====================================================
     */

    const mpesa =
      await callMpesa(
        payload
      );

    const data =
      mpesa.data || {};

    const responseCode =
      String(
        data.output_ResponseCode ||
        data.output_responseCode ||
        ""
      ).trim();

    const responseDescription =
      String(
        data.output_ResponseDesc ||
        data.output_ResponseDescription ||
        data.output_responseDesc ||
        ""
      ).trim();

    const transactionId =
      String(
        data.output_TransactionID ||
        data.output_TransactionId ||
        ""
      ).trim();

    const conversationId =
      String(
        data.output_ConversationID ||
        ""
      ).trim();


    /*
     * =====================================================
     * SUCESSO M-PESA
     * =====================================================
     */

    if (
      mpesa.httpStatus >= 200 &&
      mpesa.httpStatus < 300 &&
      responseCode === "INS-0"
    ) {

      /*
       * Guardamos o Transaction ID.
       *
       * NÃO alteramos para PAID automaticamente
       * se a resposta indicar que a operação ainda
       * está em processamento.
       */

      const transactionStatus =
        String(
          data.output_ResponseTransactionStatus ||
          ""
        ).toLowerCase();

      const isCompleted =
        transactionStatus === "completed" ||
        transactionStatus === "complete";

      const newStatus =
        isCompleted
          ? "PAID"
          : "PROCESSING";


      await sql`

        UPDATE orders

        SET

          status = ${newStatus},

          mpesa_transaction_id =
            ${transactionId || thirdPartyReference},

          updated_at =
            CURRENT_TIMESTAMP

        WHERE order_id = ${orderId}

      `;


      return json(
        res,
        200,
        {

          success: true,

          message:
            isCompleted
              ? "Pagamento M-Pesa confirmado."
              : "Pagamento M-Pesa iniciado. Aguardando confirmação.",

          order: {

            order_id:
              order.order_id,

            status:
              newStatus,

            amount:
              Number(order.amount),

            usdt_amount:
              Number(order.usdt_amount)
                .toFixed(6),

            mpesa_transaction_id:
              transactionId ||
              thirdPartyReference,

            conversation_id:
              conversationId,

            third_party_reference:
              thirdPartyReference

          }

        }
      );

    }


    /*
     * =====================================================
     * FALHA
     * =====================================================
     */

    await sql`

      UPDATE orders

      SET

        status = 'FAILED',

        updated_at =
          CURRENT_TIMESTAMP

      WHERE order_id = ${orderId}

    `;


    return json(
      res,
      mpesa.httpStatus >= 400
        ? mpesa.httpStatus
        : 400,
      {

        success: false,

        error:
          responseDescription ||
          "O M-Pesa não processou o pagamento.",

        code:
          responseCode || null,

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
     * Não revelamos credenciais,
     * tokens ou resposta interna ao cliente.
     */

    return json(
      res,
      500,
      {

        success: false,

        error:
          "Erro interno ao processar M-Pesa."

      }
    );

  }

}
