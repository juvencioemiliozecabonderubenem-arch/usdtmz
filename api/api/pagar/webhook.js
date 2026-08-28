import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

const WEBHOOK_SECRET =
  process.env.PAGAR_WEBHOOK_SECRET;

/*
 * =========================================================
 * USDTMZ — PAGAR WEBHOOK
 * =========================================================
 *
 * Recebe eventos finais da Pagar.
 *
 * Fluxo:
 *
 * Pagar
 *   ↓
 * webhook
 *   ↓
 * validar assinatura
 *   ↓
 * localizar order pela reference
 *   ↓
 * PAID
 *   ↓
 * orders = PAYMENT_CONFIRMED
 *
 * IMPORTANTE:
 * Nunca marcar PAYMENT_CONFIRMED apenas porque
 * recebemos o webhook.
 *
 * Primeiro:
 * 1. validar assinatura
 * 2. validar evento
 * 3. validar referência
 * 4. validar valor
 * 5. validar moeda
 * 6. garantir idempotência
 *
 * Somente depois:
 * PAYMENT_CONFIRMED
 * =========================================================
 */


/* =========================================================
   RESPOSTA
========================================================= */

function json(res, status, data) {

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(status)
    .json(data);
}


/* =========================================================
   BODY RAW
========================================================= */

function getRawBody(req) {

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(
      req.body,
      "utf8"
    );
  }

  return null;
}


/* =========================================================
   ASSINATURA WEBHOOK
========================================================= */

function verifyWebhookSignature(
  rawBody,
  signatureHeader
) {

  if (!WEBHOOK_SECRET) {
    return false;
  }

  if (!signatureHeader) {
    return false;
  }

  /*
   * Formato esperado:
   *
   * t=timestamp,v1=hash
   */

  const parts =
    signatureHeader
      .split(",")
      .map(part => part.trim());

  let timestamp = null;
  let receivedSignature = null;

  for (const part of parts) {

    const index =
      part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      part.slice(0, index);

    const value =
      part.slice(index + 1);

    if (key === "t") {
      timestamp = value;
    }

    if (key === "v1") {
      receivedSignature = value;
    }
  }

  if (
    !timestamp ||
    !receivedSignature
  ) {
    return false;
  }

  /*
   * Timestamp precisa ser numérico.
   */

  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  /*
   * Proteção contra replay.
   *
   * Aceitamos apenas eventos dentro
   * de uma janela de 5 minutos.
   */

  const timestampSeconds =
    Number(timestamp);

  if (
    !Number.isSafeInteger(
      timestampSeconds
    )
  ) {
    return false;
  }

  const nowSeconds =
    Math.floor(
      Date.now() / 1000
    );

  const difference =
    Math.abs(
      nowSeconds -
      timestampSeconds
    );

  if (difference > 300) {
    return false;
  }

  /*
   * Assinatura:
   *
   * timestamp.rawBody
   */

  const signedPayload =
    timestamp +
    "." +
    rawBody.toString("utf8");

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        WEBHOOK_SECRET
      )
      .update(signedPayload)
      .digest("hex");

  /*
   * Validar formato hexadecimal.
   */

  if (
    !/^[a-f0-9]{64}$/i.test(
      receivedSignature
    )
  ) {
    return false;
  }

  const received =
    Buffer.from(
      receivedSignature,
      "hex"
    );

  const expected =
    Buffer.from(
      expectedSignature,
      "hex"
    );

  if (
    received.length !==
    expected.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    received,
    expected
  );
}


/* =========================================================
   NORMALIZAR STATUS
========================================================= */

function normalizeStatus(value) {

  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}


/* =========================================================
   HANDLER
========================================================= */

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

    if (!WEBHOOK_SECRET) {

      console.error(
        "PAGAR_WEBHOOK_SECRET ausente."
      );

      return json(
        res,
        500,
        {
          success: false,
          error:
            "Webhook não configurado."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * RAW BODY
     * -----------------------------------------------------
     */

    const rawBody =
      getRawBody(req);

    if (!rawBody) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Body inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * EVENT ID
     * -----------------------------------------------------
     */

    const eventId =
      String(
        req.headers[
          "pagar-event-id"
        ] || ""
      ).trim();


    if (!eventId) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Pagar-Event-Id ausente."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ASSINATURA
     * -----------------------------------------------------
     */

    const signature =
      String(
        req.headers[
          "pagar-signature"
        ] || ""
      ).trim();


    const validSignature =
      verifyWebhookSignature(
        rawBody,
        signature
      );


    if (!validSignature) {

      console.error(
        "USDTMZ: assinatura webhook inválida."
      );

      return json(
        res,
        401,
        {
          success: false,
          error:
            "Assinatura inválida."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * PARSE JSON
     * -----------------------------------------------------
     */

    let event;

    try {

      event =
        JSON.parse(
          rawBody.toString(
            "utf8"
          )
        );

    } catch {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "JSON do webhook inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * DATABASE
     * -----------------------------------------------------
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * -----------------------------------------------------
     * IDENTIFICAR PAYMENT
     * -----------------------------------------------------
     */

    const payment =
      event?.payment ||
      event?.data?.payment ||
      event?.data ||
      null;


    const eventType =
      String(
        event?.type ||
        event?.event ||
        ""
      ).trim();


    const paymentId =
      String(
        payment?.id ||
        ""
      ).trim();


    const reference =
      String(
        payment?.reference ||
        event?.reference ||
        ""
      ).trim();


    const paymentStatus =
      normalizeStatus(
        payment?.status
      );


    /*
     * -----------------------------------------------------
     * LOG CONTROLADO
     * -----------------------------------------------------
     */

    console.log(
      "USDTMZ PAGAR WEBHOOK:",
      {
        eventId,
        eventType,
        paymentId,
        reference,
        status:
          paymentStatus
      }
    );


    /*
     * -----------------------------------------------------
     * EVENTO DUPLICADO
     * -----------------------------------------------------
     *
     * Como ainda não temos uma tabela de eventos,
     * verificamos primeiro o pedido pelo payment ID.
     *
     * Se já estiver confirmado, respondemos 200.
     */

    if (!reference) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Reference ausente no webhook."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * LOCALIZAR ORDER
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
          emola_transaction_id,
          pagar_payment_id,
          blockchain_tx_hash,
          wallet_address,
          updated_at

        FROM orders

        WHERE order_id =
          ${reference}

        LIMIT 1

      `;


    if (orders.length === 0) {

      console.error(
        "USDTMZ: order não encontrada:",
        reference
      );

      /*
       * Não confirmar pagamento desconhecido.
       */

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
     * JÁ CONFIRMADO
     * -----------------------------------------------------
     */

    if (
      order.status ===
      "PAYMENT_CONFIRMED" ||
      order.status ===
      "USDT_SENT" ||
      order.status ===
      "COMPLETED"
    ) {

      return json(
        res,
        200,
        {
          success: true,
          message:
            "Evento já processado.",
          order_id:
            order.order_id,
          status:
            order.status
        }
      );
    }


    /*
     * -----------------------------------------------------
     * APENAS PAID CONFIRMA
     * -----------------------------------------------------
     */

    if (
      paymentStatus !==
      "PAID"
    ) {

      /*
       * PROCESSING / PENDING / FAILED /
       * CANCELLED não recebem USDT.
       */

      if (
        paymentStatus ===
          "FAILED" ||
        paymentStatus ===
          "CANCELLED"
      ) {

        await sql`

          UPDATE orders

          SET

            status =
              'FAILED',

            updated_at =
              NOW()

          WHERE order_id =
            ${reference}

            AND status =
              'PENDING'

        `;

      }

      return json(
        res,
        200,
        {
          success: true,
          message:
            "Evento recebido sem confirmação financeira.",
          order_id:
            order.order_id,
          status:
            paymentStatus || "UNKNOWN"
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR VALOR
     * -----------------------------------------------------
     */

    const webhookAmount =
      Number(
        payment?.amountMzn
      );

    const orderAmount =
      Number(
        order.amount
      );


    if (
      !Number.isSafeInteger(
        webhookAmount
      ) ||
      webhookAmount !==
      orderAmount
    ) {

      console.error(
        "USDTMZ: valor do webhook não corresponde ao pedido.",
        {
          reference,
          webhookAmount,
          orderAmount
        }
      );

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Valor do pagamento não corresponde ao pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR MOEDA
     * -----------------------------------------------------
     */

    const currency =
      String(
        payment?.currency ||
        "MZN"
      ).toUpperCase();


    if (
      currency !==
      "MZN"
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Moeda do pagamento inválida."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAYMENT ID
     * -----------------------------------------------------
     */

    if (
      paymentId &&
      order.pagar_payment_id &&
      String(
        order.pagar_payment_id
      ) !== paymentId
    ) {

      console.error(
        "USDTMZ: payment ID divergente.",
        {
          reference,
          expected:
            order.pagar_payment_id,
          received:
            paymentId
        }
      );

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Pagamento não corresponde à tentativa registrada."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ATUALIZAR PAYMENT ID
     * -----------------------------------------------------
     */

    const finalPaymentId =
      paymentId ||
      order.pagar_payment_id ||
      null;


    /*
     * -----------------------------------------------------
     * TRANSACTION ID
     * -----------------------------------------------------
     */

    const providerTransactionId =
      payment?.providerTransactionId ||
      null;


    /*
     * -----------------------------------------------------
     * ATUALIZAR PEDIDO
     * -----------------------------------------------------
     *
     * Somente agora:
     *
     * PENDING
     *    ↓
     * PAYMENT_CONFIRMED
     *
     * Nenhum USDT é enviado neste arquivo.
     */

    const updated =
      await sql`

        UPDATE orders

        SET

          status =
            'PAYMENT_CONFIRMED',

          pagar_payment_id =
            COALESCE(
              ${finalPaymentId},
              pagar_payment_id
            ),

          mpesa_transaction_id =
            CASE

              WHEN UPPER(payment) =
                'MPESA'

              THEN COALESCE(
                ${providerTransactionId},
                mpesa_transaction_id
              )

              ELSE mpesa_transaction_id

            END,

          emola_transaction_id =
            CASE

              WHEN UPPER(payment) =
                'EMOLA'

              THEN COALESCE(
                ${providerTransactionId},
                emola_transaction_id
              )

              ELSE emola_transaction_id

            END,

          updated_at =
            NOW()

        WHERE order_id =
          ${reference}

          AND status =
            'PENDING'

        RETURNING

          id,
          order_id,
          status,
          amount,
          usdt_amount,
          rate,
          pagar_payment_id,
          updated_at

      `;


    /*
     * -----------------------------------------------------
     * CORRIDA / DUPLICAÇÃO
     * -----------------------------------------------------
     */

    if (updated.length === 0) {

      const current =
        await sql`

          SELECT
            order_id,
            status

          FROM orders

          WHERE order_id =
            ${reference}

          LIMIT 1

        `;

      return json(
        res,
        200,
        {
          success: true,
          message:
            "Evento já processado ou pedido mudou de estado.",
          order_id:
            reference,
          status:
            current[0]?.status ||
            null
        }
      );
    }


    const confirmed =
      updated[0];


    /*
     * -----------------------------------------------------
     * SUCESSO
     * -----------------------------------------------------
     */

    return json(
      res,
      200,
      {
        success: true,

        message:
          "Pagamento confirmado com sucesso.",

        event_id:
          eventId,

        payment_id:
          finalPaymentId,

        order: {

          order_id:
            confirmed.order_id,

          status:
            confirmed.status,

          amountMzn:
            Number(
              confirmed.amount
            ),

          usdt_amount:
            confirmed.usdt_amount,

          rate:
            confirmed.rate,

          confirmed_at:
            confirmed.updated_at

        },

        next_step:
          "PROCESS_USDT"

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ PAGAR WEBHOOK ERROR:",
      error?.message ||
      error
    );

    /*
     * 500 faz a Pagar tentar novamente.
     */

    return json(
      res,
      500,
      {
        success: false,
        error:
          "Erro interno ao processar webhook."
      }
    );
  }
}
