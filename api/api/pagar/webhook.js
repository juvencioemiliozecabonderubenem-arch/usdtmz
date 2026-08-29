import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR WEBHOOK
 * =========================================================
 *
 * POST /api/pagar/webhook
 *
 * Fluxo:
 *
 * Pagar
 *   ↓
 * validar assinatura
 *   ↓
 * validar event_id
 *   ↓
 * idempotência
 *   ↓
 * localizar order
 *   ↓
 * validar payment
 *   ↓
 * PAID
 *   ↓
 * orders = PAYMENT_CONFIRMED
 *
 * IMPORTANTE:
 * Este ficheiro NÃO transmite USDT.
 *
 * O Motor TRON será executado separadamente.
 * =========================================================
 */

const WEBHOOK_SECRET =
  process.env.PAGAR_WEBHOOK_SECRET;


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
 * HEADER
 * =========================================================
 */

function getHeader(req, name) {

  const value =
    req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value
    ? String(value)
    : null;
}


/*
 * =========================================================
 * RAW BODY
 * =========================================================
 */

function getRawBody(req) {

  if (typeof req.body === "string") {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  return null;
}


/*
 * =========================================================
 * ASSINATURA
 * =========================================================
 */

function verifySignature(
  rawBody,
  signatureHeader
) {

  if (
    !WEBHOOK_SECRET ||
    !rawBody ||
    !signatureHeader
  ) {
    return false;
  }


  const parts =
    signatureHeader.split(",");


  let timestamp = null;
  let signature = null;


  for (const part of parts) {

    const [key, ...rest] =
      part.trim().split("=");

    const value =
      rest.join("=");


    if (key === "t") {
      timestamp = value;
    }


    if (key === "v1") {
      signature = value;
    }

  }


  if (
    !timestamp ||
    !signature
  ) {
    return false;
  }


  /*
   * Proteção contra replay.
   */

  const timestampNumber =
    Number(timestamp);


  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    return false;
  }


  const timestampMs =
    timestampNumber < 1e12
      ? timestampNumber * 1000
      : timestampNumber;


  const age =
    Math.abs(
      Date.now() -
      timestampMs
    );


  if (
    age >
    5 * 60 * 1000
  ) {
    return false;
  }


  /*
   * Payload assinado.
   */

  const signedPayload =
    timestamp +
    "." +
    rawBody;


  const expected =
    crypto
      .createHmac(
        "sha256",
        WEBHOOK_SECRET
      )
      .update(
        signedPayload,
        "utf8"
      )
      .digest("hex");


  const receivedBuffer =
    Buffer.from(
      signature,
      "utf8"
    );


  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8"
    );


  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }


  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}


/*
 * =========================================================
 * PAYMENT
 * =========================================================
 */

function extractPayment(payload) {

  if (
    payload &&
    typeof payload.payment === "object"
  ) {
    return payload.payment;
  }

  return payload;
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


    if (!WEBHOOK_SECRET) {

      console.error(
        "PAGAR_WEBHOOK_SECRET não configurado."
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
            "Corpo original indisponível para validação."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * HEADERS
     * -----------------------------------------------------
     */

    const eventId =
      getHeader(
        req,
        "Pagar-Event-Id"
      );


    const signature =
      getHeader(
        req,
        "Pagar-Signature"
      );


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


    if (!signature) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Pagar-Signature ausente."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR ASSINATURA
     * -----------------------------------------------------
     */

    if (
      !verifySignature(
        rawBody,
        signature
      )
    ) {

      console.warn(
        "USDTMZ: assinatura de webhook inválida."
      );

      return json(
        res,
        401,
        {
          success: false,
          error:
            "Assinatura do webhook inválida."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * JSON
     * -----------------------------------------------------
     */

    let payload;


    try {

      payload =
        JSON.parse(rawBody);

    } catch {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Payload JSON inválido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAYMENT
     * -----------------------------------------------------
     */

    const payment =
      extractPayment(payload);


    if (
      !payment ||
      typeof payment !== "object"
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Pagamento não encontrado."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CAMPOS
     * -----------------------------------------------------
     */

    const paymentId =
      payment.id
        ? String(payment.id)
        : null;


    const reference =
      payment.reference
        ? String(payment.reference)
        : null;


    const status =
      String(
        payment.status || ""
      )
        .trim()
        .toUpperCase();


    const method =
      String(
        payment.method || ""
      )
        .trim()
        .toUpperCase();


    const providerTransactionId =
      payment.providerTransactionId
        ? String(
            payment.providerTransactionId
          )
        : null;


    const eventType =
      payload?.type ||
      payload?.event ||
      payload?.eventType ||
      null;


    if (
      !paymentId &&
      !reference
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Webhook sem payment.id e reference."
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
     * IDEMPOTÊNCIA
     * -----------------------------------------------------
     *
     * Criamos o evento como RECEIVED.
     *
     * Não o marcamos PROCESSED ainda.
     * -----------------------------------------------------
     */

    const inserted =
      await sql`

        INSERT INTO pagar_webhook_events (

          event_id,
          event_type,
          payment_id,
          reference,
          payload,
          status,
          received_at,
          updated_at

        )

        VALUES (

          ${eventId},
          ${eventType},
          ${paymentId},
          ${reference},
          ${JSON.stringify(payload)}::jsonb,
          'RECEIVED',
          NOW(),
          NOW()

        )

        ON CONFLICT (event_id)
        DO NOTHING

        RETURNING id

      `;


    /*
     * -----------------------------------------------------
     * EVENTO JÁ EXISTE
     * -----------------------------------------------------
     */

    if (
      inserted.length === 0
    ) {

      const existing =
        await sql`

          SELECT
            status

          FROM pagar_webhook_events

          WHERE event_id =
            ${eventId}

          LIMIT 1

        `;


      const existingStatus =
        existing[0]?.status ||
        "UNKNOWN";


      /*
       * Se já foi concluído, respondemos OK.
       */

      if (
        existingStatus ===
        "PROCESSED"
      ) {

        return json(
          res,
          200,
          {
            success: true,
            duplicate: true,
            status:
              "PROCESSED"
          }
        );
      }


      /*
       * Se está em processamento,
       * não executamos novamente.
       */

      if (
        existingStatus ===
        "PROCESSING"
      ) {

        return json(
          res,
          200,
          {
            success: true,
            duplicate: true,
            status:
              "PROCESSING"
          }
        );
      }


      /*
       * Para RECEIVED/FAILED,
       * continuamos com cautela.
       */

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'PROCESSING',

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;

    } else {

      /*
       * Primeiro processamento.
       */

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'PROCESSING',

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;

    }


    /*
     * -----------------------------------------------------
     * LOCALIZAR ORDER
     * -----------------------------------------------------
     */

    let orders = [];


    if (reference) {

      orders =
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

    }


    /*
     * Fallback pelo payment ID.
     */

    if (
      orders.length === 0 &&
      paymentId
    ) {

      orders =
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

          WHERE pagar_payment_id =
            ${paymentId}

          LIMIT 1

        `;

    }


    /*
     * -----------------------------------------------------
     * PEDIDO NÃO ENCONTRADO
     * -----------------------------------------------------
     */

    if (
      orders.length === 0
    ) {

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'FAILED',

          error_message =
            'Pedido USDTMZ não encontrado.',

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;


      /*
       * Respondemos 200 porque o evento foi
       * recebido e validado, mas não há pedido.
       */

      return json(
        res,
        200,
        {
          success: true,
          processed: false,
          status:
            "ORDER_NOT_FOUND"
        }
      );
    }


    const order =
      orders[0];


    /*
     * -----------------------------------------------------
     * VALIDAR PAYMENT ID
     * -----------------------------------------------------
     */

    if (
      order.pagar_payment_id &&
      paymentId &&
      String(
        order.pagar_payment_id
      ) !== paymentId
    ) {

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'FAILED',

          error_message =
            'Payment ID incompatível.',

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;


      return json(
        res,
        409,
        {
          success: false,
          error:
            "Pagamento incompatível com o pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR VALOR
     * -----------------------------------------------------
     */

    const expectedAmount =
      Number(order.amount);


    const receivedAmount =
      Number(
        payment.amountMzn
      );


    if (
      !Number.isFinite(
        receivedAmount
      ) ||
      receivedAmount !==
        expectedAmount
    ) {

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'FAILED',

          error_message =
            'Valor incompatível.',

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;


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
     * VALIDAR MÉTODO
     * -----------------------------------------------------
     */

    const expectedMethod =
      String(
        order.payment || ""
      )
        .trim()
        .toUpperCase();


    if (
      method &&
      expectedMethod &&
      method !==
        expectedMethod
    ) {

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'FAILED',

          error_message =
            'Método incompatível.',

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;


      return json(
        res,
        409,
        {
          success: false,
          error:
            "Método de pagamento não corresponde ao pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * GUARDAR PAYMENT ID
     * -----------------------------------------------------
     */

    await sql`

      UPDATE orders

      SET

        pagar_payment_id =
          COALESCE(
            pagar_payment_id,
            ${paymentId}
          ),

        updated_at =
          NOW()

      WHERE order_id =
        ${order.order_id}

    `;


    /*
     * -----------------------------------------------------
     * GUARDAR TRANSACTION ID
     * -----------------------------------------------------
     */

    if (
      providerTransactionId &&
      expectedMethod ===
        "MPESA"
    ) {

      await sql`

        UPDATE orders

        SET

          mpesa_transaction_id =
            ${providerTransactionId},

          updated_at =
            NOW()

        WHERE order_id =
          ${order.order_id}

      `;

    }


    if (
      providerTransactionId &&
      expectedMethod ===
        "EMOLA"
    ) {

      await sql`

        UPDATE orders

        SET

          emola_transaction_id =
            ${providerTransactionId},

          updated_at =
            NOW()

        WHERE order_id =
          ${order.order_id}

      `;

    }


    /*
     * -----------------------------------------------------
     * PAGAMENTO CONFIRMADO
     * -----------------------------------------------------
     */

    if (
      status ===
      "PAID"
    ) {

      /*
       * Só avançamos pedidos que ainda
       * precisam da confirmação.
       *
       * Não voltamos estados avançados para trás.
       */

      await sql`

        UPDATE orders

        SET

          status =
            CASE

              WHEN status IN (
                'USDT_SENT',
                'COMPLETED'
              )
              THEN status

              ELSE
                'PAYMENT_CONFIRMED'

            END,

          updated_at =
            NOW()

        WHERE order_id =
          ${order.order_id}

      `;


      /*
       * Evento concluído.
       */

      await sql`

        UPDATE pagar_webhook_events

        SET

          status =
            'PROCESSED',

          processed_at =
            NOW(),

          error_message =
            NULL,

          updated_at =
            NOW()

        WHERE event_id =
          ${eventId}

      `;


      console.log(
        "USDTMZ PAYMENT CONFIRMED",
        {
          eventId,
          orderId:
            order.order_id,
          paymentId,
          method,
          amount:
            expectedAmount
        }
      );


      return json(
        res,
        200,
        {
          success: true,
          processed: true,
          status:
            "PAYMENT_CONFIRMED",
          order_id:
            order.order_id
        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAGAMENTO AINDA NÃO PAGO
     * -----------------------------------------------------
     */

    await sql`

      UPDATE pagar_webhook_events

      SET

        status =
          'PROCESSED',

        processed_at =
          NOW(),

        updated_at =
          NOW()

      WHERE event_id =
        ${eventId}

    `;


    return json(
      res,
      200,
      {
        success: true,
        processed: true,
        status:
          "PENDING",
        payment_status:
          status || null,
        order_id:
          order.order_id
      }
    );


  } catch (error) {

    console.error(
      "USDTMZ PAGAR WEBHOOK ERROR:",
      error?.message ||
      error
    );


    /*
     * Não expomos detalhes internos.
     */

    try {

      const sql =
        neon(
          process.env.DATABASE_URL
        );


      /*
       * Se houver event_id disponível,
       * marcamos o evento como FAILED.
       */

      const eventId =
        getHeader(
          req,
          "Pagar-Event-Id"
        );


      if (eventId) {

        await sql`

          UPDATE pagar_webhook_events

          SET

            status =
              'FAILED',

            error_message =
              ${String(
                error?.message ||
                "Erro interno"
              ).slice(0, 500)},

            updated_at =
              NOW()

          WHERE event_id =
            ${eventId}

        `;

      }

    } catch (dbError) {

      console.error(
        "USDTMZ WEBHOOK ERROR UPDATE:",
        dbError?.message ||
        dbError
      );

    }


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
