import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR PAYMENT API
 * =========================================================
 *
 * POST /api/payment
 *
 * Cria um pagamento M-Pesa/eMola através da Pagar API.
 *
 * IMPORTANTE:
 * - A API Key e o Signing Secret ficam somente no servidor.
 * - HTTP 202 significa PROCESSING, não pagamento confirmado.
 * - A confirmação definitiva será feita pelo webhook.
 *
 * Tabela utilizada:
 * orders
 *
 * Colunas existentes:
 * id
 * order_id
 * name
 * phone
 * operation
 * payment
 * amount
 * usdt_amount
 * rate
 * status
 * created_at
 * mpesa_transaction_id
 * blockchain_tx_hash
 * wallet_address
 * updated_at
 * emola_transaction_id
 */

const API_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

const API_KEY =
  process.env.PAGAR_API_KEY;

const SIGNING_SECRET =
  process.env.PAGAR_SIGNING_SECRET;


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

  return res
    .status(status)
    .json(data);
}


/*
 * =========================================================
 * NORMALIZAR MÉTODO DE PAGAMENTO
 * =========================================================
 */

function normalizeMethod(value) {

  const method =
    String(value || "")
      .trim()
      .toUpperCase();

  if (method === "MPESA") {
    return "MPESA";
  }

  if (method === "EMOLA") {
    return "EMOLA";
  }

  return null;
}


/*
 * =========================================================
 * ASSINATURA PAGAR
 * =========================================================
 */

function createSignature(
  method,
  pathname,
  rawBody
) {

  const timestamp =
    Date.now().toString();

  const nonce =
    crypto
      .randomBytes(18)
      .toString("base64url");

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const canonical = [
    timestamp,
    nonce,
    method,
    pathname,
    bodyHash
  ].join("\n");

  const signature =
    crypto
      .createHmac(
        "sha256",
        SIGNING_SECRET
      )
      .update(canonical)
      .digest("hex");

  return {
    timestamp,
    nonce,
    signature: "v1=" + signature
  };
}


/*
 * =========================================================
 * CHAMAR PAGAR
 * =========================================================
 */

async function pagarPost(
  pathname,
  body,
  idempotencyKey
) {

  if (!API_KEY) {
    throw new Error(
      "PAGAR_API_KEY não configurada."
    );
  }

  if (!SIGNING_SECRET) {
    throw new Error(
      "PAGAR_SIGNING_SECRET não configurado."
    );
  }

  const rawBody =
    JSON.stringify(body);

  const url =
    API_URL + pathname;

  const canonicalPath =
    new URL(url).pathname;

  const auth =
    createSignature(
      "POST",
      canonicalPath,
      rawBody
    );

  const response =
    await fetch(url, {

      method: "POST",

      headers: {

        Authorization:
          "Bearer " + API_KEY,

        "Content-Type":
          "application/json",

        "Idempotency-Key":
          idempotencyKey,

        "X-Pagar-Timestamp":
          auth.timestamp,

        "X-Pagar-Nonce":
          auth.nonce,

        "X-Pagar-Signature":
          auth.signature

      },

      body: rawBody

    });

  let data = null;

  try {

    data =
      await response.json();

  } catch {

    data = null;

  }


  if (!response.ok) {

    const error =
      new Error(
        data?.message ||
        "Pedido rejeitado pela Pagar API."
      );

    error.code =
      data?.error;

    error.requestId =
      data?.requestId;

    error.httpStatus =
      response.status;

    throw error;
  }


  return data;
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
   * MÉTODO
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
          "Método não permitido."
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
            "PAGAR_API_KEY não configurada."
        }
      );
    }

    if (!SIGNING_SECRET) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "PAGAR_SIGNING_SECRET não configurado."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * DATABASE
     * -----------------------------------------------------
     */

    const sql =
      neon(process.env.DATABASE_URL);


    /*
     * -----------------------------------------------------
     * BODY
     * -----------------------------------------------------
     *
     * Esperado:
     *
     * {
     *   "order_id": "...",
     *   "payment": "MPESA",
     *   "phone": "84..."
     * }
     *
     * ou:
     *
     * {
     *   "order_id": "...",
     *   "payment": "EMOLA",
     *   "phone": "86..."
     * }
     */

    const body =
      req.body || {};


    const orderId =
      String(
        body.order_id ||
        ""
      ).trim();


    const requestedMethod =
      normalizeMethod(
        body.payment ||
        body.method
      );


    const requestedPhone =
      String(
        body.phone ||
        ""
      ).trim();


    /*
     * -----------------------------------------------------
     * VALIDAR ORDER_ID
     * -----------------------------------------------------
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
     * -----------------------------------------------------
     * VALIDAR MÉTODO
     * -----------------------------------------------------
     */

    if (!requestedMethod) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Método de pagamento inválido. Use MPESA ou EMOLA."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * LOCALIZAR PEDIDO
     * -----------------------------------------------------
     */

    const orders =
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
          created_at,
          mpesa_transaction_id,
          blockchain_tx_hash,
          wallet_address,
          updated_at,
          emola_transaction_id

        FROM orders

        WHERE order_id =
          ${orderId}

        LIMIT 1

      `;


    if (orders.length === 0) {

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
      orders[0];


    /*
     * -----------------------------------------------------
     * IMPEDIR NOVA COBRANÇA DE PEDIDO JÁ CONCLUÍDO
     * -----------------------------------------------------
     */

    const currentStatus =
      String(
        order.status || ""
      ).toUpperCase();


    if (
      currentStatus === "PAID" ||
      currentStatus === "COMPLETED" ||
      currentStatus === "SUCCESS"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Este pedido já foi pago.",
          order_id:
            order.order_id,
          status:
            order.status
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALOR
     * -----------------------------------------------------
     *
     * O valor vem da BASE DE DADOS.
     *
     * Nunca confiamos no amount enviado pelo frontend.
     */

    const amount =
      Number(order.amount);


    if (
      !Number.isSafeInteger(amount) ||
      amount < 20 ||
      amount > 40000
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "O valor do pedido deve ser um número inteiro entre 20 e 40.000 MZN."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * TELEFONE
     * -----------------------------------------------------
     *
     * Se o frontend enviar telefone,
     * usamos apenas para validar/atualizar
     * a informação do pedido.
     *
     * O valor definitivo vem da BD.
     */

    const payerPhone =
      requestedPhone ||
      String(
        order.phone || ""
      ).trim();


    if (!payerPhone) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Número de telefone não encontrado."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * REFERENCE
     * -----------------------------------------------------
     */

    const reference =
      String(
        order.order_id
      );


    /*
     * -----------------------------------------------------
     * TITLE
     * -----------------------------------------------------
     */

    const title =
      "USDTMZ";


    /*
     * -----------------------------------------------------
     * DESCRIPTION
     * -----------------------------------------------------
     */

    const description =
      `Pedido ${reference} — ${amount} MZN`;


    /*
     * -----------------------------------------------------
     * IDEMPOTÊNCIA
     * -----------------------------------------------------
     *
     * O mesmo pedido usa a mesma chave enquanto
     * estivermos a recuperar a mesma tentativa.
     */

    const idempotencyKey =
      "payment:" +
      reference;


    /*
     * -----------------------------------------------------
     * CRIAR PAGAMENTO NA PAGAR
     * -----------------------------------------------------
     */

    const pagarResponse =
      await pagarPost(

        "/payments",

        {
          reference,

          title,

          description,

          amountMzn:
            amount,

          method:
            requestedMethod,

          payerPhone

        },

        idempotencyKey

      );


    const payment =
      pagarResponse?.payment ||
      pagarResponse;


    if (!payment?.id) {

      console.error(
        "PAGAR INVALID RESPONSE:",
        pagarResponse
      );

      return json(
        res,
        502,
        {
          success: false,
          error:
            "A Pagar não devolveu um ID de pagamento válido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * GUARDAR ESTADO INICIAL
     * -----------------------------------------------------
     *
     * NÃO marcamos PAID aqui.
     *
     * 202/PROCESSING não significa dinheiro recebido.
     */

    await sql`

      UPDATE orders

      SET

        status =
          CASE

            WHEN ${String(
              payment.status || ""
            ).toUpperCase()} = 'PAID'

            THEN 'PAID'

            ELSE 'PENDING'

          END,

        payment =
          ${requestedMethod},

        updated_at =
          NOW()

      WHERE order_id =
        ${orderId}

    `;


    /*
     * -----------------------------------------------------
     * TRANSACTION ID
     * -----------------------------------------------------
     *
     * Se a Pagar já devolver providerTransactionId,
     * guardamos na coluna correspondente.
     */

    const providerTransactionId =
      payment.providerTransactionId ||
      null;


    if (
      providerTransactionId &&
      requestedMethod === "MPESA"
    ) {

      await sql`

        UPDATE orders

        SET

          mpesa_transaction_id =
            ${String(
              providerTransactionId
            )},

          updated_at =
            NOW()

        WHERE order_id =
          ${orderId}

      `;

    }


    if (
      providerTransactionId &&
      requestedMethod === "EMOLA"
    ) {

      await sql`

        UPDATE orders

        SET

          emola_transaction_id =
            ${String(
              providerTransactionId
            )},

          updated_at =
            NOW()

        WHERE order_id =
          ${orderId}

      `;

    }


    /*
     * -----------------------------------------------------
     * RESPOSTA
     * -----------------------------------------------------
     */

    return json(
      res,
      202,
      {

        success: true,

        payment: {

          id:
            payment.id,

          status:
            payment.status,

          environment:
            payment.environment,

          purpose:
            payment.purpose,

          reference:
            payment.reference ||
            reference,

          amountMzn:
            payment.amountMzn ||
            amount,

          currency:
            payment.currency ||
            "MZN",

          method:
            payment.method ||
            requestedMethod,

          payerPhone:
            payment.payerPhone ||
            null,

          providerTransactionId:
            payment.providerTransactionId ||
            null,

          failureReason:
            payment.failureReason ||
            null,

          paidAt:
            payment.paidAt ||
            null

        },

        order: {

          order_id:
            order.order_id,

          status:
            payment.status === "PAID"
              ? "PAID"
              : "PENDING",

          amountMzn:
            amount,

          usdt_amount:
            order.usdt_amount,

          rate:
            order.rate

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ PAGAR PAYMENT ERROR:",
      error?.message ||
      error
    );


    /*
     * -----------------------------------------------------
     * ERRO DE CONFLITO
     * -----------------------------------------------------
     */

    if (
      error?.httpStatus === 409
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            error.message ||
            "Conflito ao criar o pagamento.",
          code:
            error.code || null,
          requestId:
            error.requestId || null
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ERRO DE AUTENTICAÇÃO
     * -----------------------------------------------------
     */

    if (
      error?.httpStatus === 401 ||
      error?.httpStatus === 403
    ) {

      return json(
        res,
        502,
        {
          success: false,
          error:
            "A Pagar recusou a autenticação da API.",
          requestId:
            error.requestId || null
        }
      );
    }


    /*
     * -----------------------------------------------------
     * RATE LIMIT
     * -----------------------------------------------------
     */

    if (
      error?.httpStatus === 429
    ) {

      return json(
        res,
        429,
        {
          success: false,
          error:
            "Limite temporário da API atingido. Tente novamente mais tarde.",
          requestId:
            error.requestId || null
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ERRO GERAL
     * -----------------------------------------------------
     */

    return json(
      res,
      500,
      {
        success: false,
        error:
          "Erro interno ao criar o pagamento.",
        requestId:
          error?.requestId || null
      }
    );

  }

}
