import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR WEBHOOK
 * =========================================================
 *
 * POST /api/pagar/webhook
 *
 * Responsabilidades:
 * - validar Pagar-Signature
 * - validar Pagar-Event-Id
 * - impedir processamento duplicado
 * - localizar o pedido USDTMZ
 * - confirmar pagamento somente quando PAID
 * - guardar IDs M-Pesa/eMola
 *
 * IMPORTANTE:
 * Este endpoint NÃO envia USDT.
 *
 * O envio TRON acontece somente depois de:
 *
 * PENDING
 *    ↓
 * PAYMENT_CONFIRMED
 *
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
 * RAW BODY
 * =========================================================
 *
 * A assinatura deve ser calculada sobre o corpo original.
 * Não fazemos JSON.stringify novamente antes da validação.
 * =========================================================
 */

function getRawBody(req) {

  if (typeof req.body === "string") {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  /*
   * Vercel normalmente entrega req.body já parseado.
   * Se não tivermos acesso ao raw body, NÃO tentamos
   * adivinhar a assinatura.
   */

  return null;
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
 * VALIDAR ASSINATURA
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


  /*
   * Formato esperado:
   *
   * t=timestamp,v1=signature
   */

  const parts =
    signatureHeader
      .split(",");

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
   * Evita replay de eventos antigos.
   *
   * Janela de 5 minutos.
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

  if (age > 5 * 60 * 1000) {
    return false;
  }


  /*
   * Assinatura:
   *
   * timestamp + "." + rawBody
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


  /*
   * Comparação segura.
   */

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
 * EXTRAIR PAYMENT
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
            "Webhook não configurado no servidor."
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
     * RAW BODY
     * -----------------------------------------------------
     */

    const rawBody =
      getRawBody(req);


    if (!rawBody) {

      /*
       * Nunca processamos webhook sem
       * conseguir verificar a assinatura.
       */

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Corpo original do webhook indisponível para validação."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ASSINATURA
     * -----------------------------------------------------
     */

    const validSignature =
      verifySignature(
        rawBody,
        signature
      );


    if (!validSignature) {

      console.warn(
        "PAGAR WEBHOOK: assinatura inválida."
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
            "Pagamento não encontrado no webhook."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * CAMPOS PRINCIPAIS
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


    /*
     * -----------------------------------------------------
     * EVENTO MÍNIMO
     * -----------------------------------------------------
     */

    if (!paymentId && !reference) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Webhook não contém payment.id nem reference."
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
     * IDEMPOTÊNCIA DO EVENTO
     * -----------------------------------------------------
     *
     * Primeiro tentamos registrar o event_id.
     *
     * Se já existir, o webhook já foi processado.
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
          processed_at

        )

        VALUES (

          ${eventId},
          ${eventType},
          ${paymentId},
          ${reference},
          ${JSON.stringify(payload)}::jsonb,
          NOW()

        )

        ON CONFLICT (event_id)
        DO NOTHING

        RETURNING id

      `;


    if (inserted.length === 0) {

      return json(
        res,
        200,
        {
          success: true,
          duplicate: true,
          message:
            "Webhook já processado."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * LOCALIZAR PEDIDO
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
     * Se reference não encontrar,
     * tentamos pelo payment ID já gravado.
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

    if (orders.length === 0) {

      console.error(
        "PAGAR WEBHOOK: pedido não encontrado.",
        {
          eventId,
          paymentId,
          reference
        }
      );

      /*
       * O evento continua registrado para
       * impedir processamento infinito.
       */

      return json(
        res,
        200,
        {
          success: true,
          processed: false,
          message:
            "Webhook recebido, mas o pedido não foi encontrado."
        }
      );
    }


    const order =
      orders[0];


    /*
     * -----------------------------------------------------
     * VALIDAR PAYMENT ID
     * -----------------------------------------------------
     *
     * Se já existir outro payment ID no pedido,
     * não substituímos silenciosamente.
     * -----------------------------------------------------
     */

    if (
      order.pagar_payment_id &&
      paymentId &&
      String(
        order.pagar_payment_id
      ) !== paymentId
    ) {

      console.error(
        "PAGAR WEBHOOK: payment ID incompatível.",
        {
          orderId:
            order.order_id,
          existing:
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
            "Pagamento incompatível com o pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR VALOR
     * -----------------------------------------------------
     *
     * O valor esperado vem de orders.amount.
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

      console.error(
        "PAGAR WEBHOOK: valor incompatível.",
        {
          orderId:
            order.order_id,
          expected:
            expectedAmount,
          received:
            receivedAmount
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
      method !== expectedMethod
    ) {

      console.error(
        "PAGAR WEBHOOK: método incompatível.",
        {
          orderId:
            order.order_id,
          expected:
            expectedMethod,
          received:
            method
        }
      );

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
          ${paymentId},

        updated_at =
          NOW()

      WHERE order_id =
        ${order.order_id}

    `;


    /*
     * -----------------------------------------------------
     * STATUS
     * -----------------------------------------------------
     *
     * SOMENTE PAID confirma pagamento.
     *
     * PROCESSING/PENDING continuam PENDING.
     * -----------------------------------------------------
     */

    if (status === "PAID") {

      /*
       * Guardar transaction ID.
       */

      if (
        providerTransactionId &&
        expectedMethod === "MPESA"
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
        expectedMethod === "EMOLA"
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
       * Não sobrescrever COMPLETED.
       */

      await sql`

        UPDATE orders

        SET

          status =
            CASE

              WHEN status =
                'COMPLETED'

              THEN status

              WHEN status =
                'USDT_SENT'

              THEN status

              ELSE 'PAYMENT_CONFIRMED'

            END,

          updated_at =
            NOW()

        WHERE order_id =
          ${order.order_id}

      `;


      console.log(
        "USDTMZ PAYMENT CONFIRMED:",
        {
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
     * PAGAMENTO AINDA NÃO CONFIRMADO
     * -----------------------------------------------------
     */

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
