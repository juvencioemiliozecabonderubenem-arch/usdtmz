import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR WEBHOOK
 * POST /api/pagar-webhook
 *
 * Fluxo:
 *
 * Pagar
 *   ↓
 * POST /api/pagar-webhook
 *   ↓
 * valida headers
 *   ↓
 * valida assinatura HMAC
 *   ↓
 * valida event_id
 *   ↓
 * localiza pedido
 *   ↓
 * valida payment.id / reference / amount
 *   ↓
 * payment.succeeded + PAID
 *   ↓
 * PAYMENT_CONFIRMED
 *
 * IMPORTANTE:
 * - O frontend nunca confirma pagamento.
 * - O body bruto é usado na assinatura.
 * - event_id é único.
 * - Somente payment.succeeded + PAID confirma.
 * - PENDING / PROCESSING não confirmam.
 * - Secrets ficam somente nas Environment Variables.
 * =========================================================
 */


/* =========================================================
 * RESPOSTA JSON
 * ========================================================= */

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}


/* =========================================================
 * HEADER
 * ========================================================= */

function getHeader(req, name) {
  const wanted =
    name.toLowerCase();

  const headers =
    req.headers || {};

  const key =
    Object.keys(headers).find(
      (k) =>
        k.toLowerCase() === wanted
    );

  if (!key) {
    return null;
  }

  const value =
    headers[key];

  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value
    ? String(value)
    : null;
}


/* =========================================================
 * BODY BRUTO
 *
 * IMPORTANTE:
 * A assinatura HMAC precisa do body exatamente como
 * foi recebido.
 * ========================================================= */

async function getRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(
        Buffer.from(chunk)
      );
    }
  }

  return Buffer
    .concat(chunks)
    .toString("utf8");
}


/* =========================================================
 * COMPARAÇÃO SEGURA DE HASH
 * ========================================================= */

function safeCompareHex(
  received,
  expected
) {
  if (
    typeof received !== "string" ||
    typeof expected !== "string"
  ) {
    return false;
  }

  if (
    !/^[a-f0-9]{64}$/i.test(received) ||
    !/^[a-f0-9]{64}$/i.test(expected)
  ) {
    return false;
  }

  const receivedBuffer =
    Buffer.from(
      received,
      "hex"
    );

  const expectedBuffer =
    Buffer.from(
      expected,
      "hex"
    );

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}


/* =========================================================
 * TIMESTAMP
 *
 * Aceita:
 *
 * 10 dígitos → segundos
 * 13 dígitos → milissegundos
 *
 * Janela: 15 minutos
 * ========================================================= */

function getTimestampSeconds(
  timestamp
) {
  const number =
    Number(timestamp);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  /*
   * Timestamp de 13 dígitos:
   * milissegundos
   */
  if (
    number >= 100000000000
  ) {
    return number / 1000;
  }

  /*
   * Timestamp de 10 dígitos:
   * segundos
   */
  return number;
}


/* =========================================================
 * VERIFICAÇÃO HMAC
 * ========================================================= */

function verifyWebhook(
  req,
  rawBody
) {
  const secret =
    process.env.PAGAR_WEBHOOK_SECRET;

  if (!secret) {
    return {
      ok: false,
      status: 500,
      error:
        "PAGAR_WEBHOOK_SECRET não configurado."
    };
  }

  const eventId =
    getHeader(
      req,
      "Pagar-Event-Id"
    );

  if (!eventId) {
    return {
      ok: false,
      status: 400,
      error:
        "Pagar-Event-Id ausente."
    };
  }

  const signatureHeader =
    getHeader(
      req,
      "Pagar-Signature"
    );

  if (!signatureHeader) {
    return {
      ok: false,
      status: 401,
      error:
        "Pagar-Signature ausente."
    };
  }


  /* =======================================================
   * LER:
   *
   * t=timestamp
   * v1=assinatura
   * ======================================================= */

  let timestamp = null;
  let receivedSignature = null;

  const parts =
    String(signatureHeader)
      .split(",");

  for (const part of parts) {
    const index =
      part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      part
        .slice(0, index)
        .trim();

    const value =
      part
        .slice(index + 1)
        .trim();

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
    return {
      ok: false,
      status: 401,
      error:
        "Assinatura Pagar inválida."
    };
  }


  /* =======================================================
   * VALIDAR TIMESTAMP
   * ======================================================= */

  if (
    !/^\d+$/.test(timestamp)
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "Timestamp inválido."
    };
  }


  const timestampSeconds =
    getTimestampSeconds(
      timestamp
    );

  if (
    timestampSeconds === null
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "Timestamp inválido."
    };
  }


  /* =======================================================
   * EXPIRAÇÃO
   *
   * 15 minutos
   * ======================================================= */

  const now =
    Date.now() / 1000;

  const age =
    Math.abs(
      now -
      timestampSeconds
    );

  if (
    !Number.isFinite(age) ||
    age > 900
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "Webhook expirado."
    };
  }


  /* =======================================================
   * VALIDAR FORMATO DA ASSINATURA
   * ======================================================= */

  if (
    !/^[a-f0-9]{64}$/i.test(
      receivedSignature
    )
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "Formato de assinatura inválido."
    };
  }


  /* =======================================================
   * CALCULAR HMAC
   *
   * Pagar:
   *
   * timestamp + "." + rawBody
   * ======================================================= */

  const signedPayload =
    `${timestamp}.${rawBody}`;

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(
        signedPayload,
        "utf8"
      )
      .digest("hex");


  /* =======================================================
   * COMPARAR
   * ======================================================= */

  const valid =
    safeCompareHex(
      receivedSignature,
      expectedSignature
    );

  if (!valid) {
    return {
      ok: false,
      status: 401,
      error:
        "Assinatura inválida."
    };
  }


  return {
    ok: true,
    eventId:
      String(eventId).trim()
  };
}


/* =========================================================
 * EVENT TYPE
 * ========================================================= */

function getEventType(event) {
  return String(
    event?.type ||
    event?.event ||
    ""
  )
    .trim()
    .toLowerCase();
}


/* =========================================================
 * PAYMENT
 * ========================================================= */

function getPayment(event) {
  return (
    event?.payment ||
    event?.data?.payment ||
    event?.data ||
    {}
  );
}


/* =========================================================
 * HANDLER
 * ========================================================= */

export default async function handler(
  req,
  res
) {

  /* =======================================================
   * MÉTODO
   * ======================================================= */

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


  /* =======================================================
   * ENVIRONMENT VARIABLES
   * ======================================================= */

  if (!process.env.DATABASE_URL) {

    return json(res, 500, {
      success: false,
      error:
        "DATABASE_URL não configurada."
    });
  }

  if (!process.env.PAGAR_WEBHOOK_SECRET) {

    return json(res, 500, {
      success: false,
      error:
        "PAGAR_WEBHOOK_SECRET não configurado."
    });
  }


  try {

    /* =====================================================
     * BODY BRUTO
     * ===================================================== */

    const rawBody =
      await getRawBody(req);

    if (!rawBody) {

      return json(res, 400, {
        success: false,
        error:
          "Body do webhook vazio."
      });
    }


    /* =====================================================
     * SEGURANÇA
     * ===================================================== */

    const verification =
      verifyWebhook(
        req,
        rawBody
      );

    if (!verification.ok) {

      console.error(
        "USDTMZ WEBHOOK VERIFY ERROR:",
        verification.error
      );

      return json(
        res,
        verification.status,
        {
          success: false,
          error:
            verification.error
        }
      );
    }


    const eventId =
      verification.eventId;


    /* =====================================================
     * JSON
     * ===================================================== */

    let event;

    try {

      event =
        JSON.parse(rawBody);

    } catch {

      return json(res, 400, {
        success: false,
        error:
          "JSON do webhook inválido."
      });
    }


    /* =====================================================
     * DADOS DO EVENTO
     * ===================================================== */

    const eventType =
      getEventType(event);

    const payment =
      getPayment(event);


    const paymentId =
      payment?.id
        ? String(payment.id)
        : null;


    const reference =
      payment?.reference
        ? String(
            payment.reference
          ).trim()
        : null;


    const paymentStatus =
      String(
        payment?.status || ""
      )
        .trim()
        .toUpperCase();


    const amountMzn =
      Number(
        payment?.amountMzn
      );


    /* =====================================================
     * DATABASE
     * ===================================================== */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /* =====================================================
     * IDEMPOTÊNCIA
     * ===================================================== */

    const existing =
      await sql`
        SELECT
          id
        FROM pagar_webhook_events
        WHERE event_id = ${eventId}
        LIMIT 1
      `;


    if (
      existing.length > 0
    ) {

      return json(res, 200, {
        success: true,
        duplicate: true,
        event_id: eventId
      });
    }


    /* =====================================================
     * EVENTOS QUE NÃO SÃO DE PAGAMENTO
     * ===================================================== */

    if (
      !eventType.startsWith(
        "payment."
      )
    ) {

      await sql`
        INSERT INTO pagar_webhook_events (
          event_id,
          event_type,
          payment_id,
          reference,
          payload,
          processed_at,
          created_at
        )
        VALUES (
          ${eventId},
          ${eventType || null},
          ${paymentId},
          ${reference},
          ${JSON.stringify(event)}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (event_id)
        DO NOTHING
      `;

      return json(res, 200, {
        success: true,
        ignored: true,
        event:
          eventType || null,
        event_id: eventId
      });
    }


    /* =====================================================
     * PAYMENT PRECISA TER ID OU REFERENCE
     * ===================================================== */

    if (
      !paymentId &&
      !reference
    ) {

      return json(res, 400, {
        success: false,
        error:
          "Pagamento sem ID ou reference."
      });
    }


    /* =====================================================
     * LOCALIZAR PEDIDO
     * ===================================================== */

    let orders = [];


    if (reference) {

      orders =
        await sql`
          SELECT
            id,
            order_id,
            status,
            amount,
            usdt_amount,
            rate,
            payment,
            pagar_payment_id
          FROM orders
          WHERE order_id = ${reference}
          LIMIT 1
        `;
    }


    if (
      orders.length === 0 &&
      paymentId
    ) {

      orders =
        await sql`
          SELECT
            id,
            order_id,
            status,
            amount,
            usdt_amount,
            rate,
            payment,
            pagar_payment_id
          FROM orders
          WHERE pagar_payment_id = ${paymentId}
          LIMIT 1
        `;
    }


    /* =====================================================
     * PEDIDO NÃO ENCONTRADO
     * ===================================================== */

    if (
      orders.length === 0
    ) {

      await sql`
        INSERT INTO pagar_webhook_events (
          event_id,
          event_type,
          payment_id,
          reference,
          payload,
          processed_at,
          created_at
        )
        VALUES (
          ${eventId},
          ${eventType || null},
          ${paymentId},
          ${reference},
          ${JSON.stringify(event)}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (event_id)
        DO NOTHING
      `;

      console.error(
        "USDTMZ WEBHOOK: pedido não encontrado",
        {
          eventId,
          eventType,
          paymentId,
          reference
        }
      );

      return json(res, 200, {
        success: true,
        orderFound: false,
        event_id: eventId
      });
    }


    const order =
      orders[0];


    /* =====================================================
     * VALIDAR PAYMENT ID
     * ===================================================== */

    if (
      order.pagar_payment_id &&
      paymentId &&
      String(
        order.pagar_payment_id
      ) !== paymentId
    ) {

      return json(res, 409, {
        success: false,
        error:
          "payment.id não corresponde ao pedido."
      });
    }


    /* =====================================================
     * VALIDAR REFERENCE
     * ===================================================== */

    if (
      reference &&
      String(
        order.order_id
      ) !== reference
    ) {

      return json(res, 409, {
        success: false,
        error:
          "Reference não corresponde ao pedido."
      });
    }


    /* =====================================================
     * VALIDAR VALOR
     * ===================================================== */

    const orderAmount =
      Number(order.amount);


    if (
      !Number.isFinite(
        amountMzn
      )
    ) {

      return json(res, 400, {
        success: false,
        error:
          "Pagamento sem amountMzn válido."
      });
    }


    if (
      amountMzn !==
      orderAmount
    ) {

      console.error(
        "USDTMZ WEBHOOK: valor incompatível",
        {
          orderId:
            order.order_id,
          expected:
            orderAmount,
          received:
            amountMzn
        }
      );

      return json(res, 409, {
        success: false,
        error:
          "O valor pago não corresponde ao valor do pedido."
      });
    }


    /* =====================================================
     * PAGAMENTO CONFIRMADO
     *
     * SOMENTE:
     *
     * payment.succeeded
     * +
     * PAID
     * ===================================================== */

    const confirmed =
      eventType ===
        "payment.succeeded" &&
      paymentStatus ===
        "PAID";


    if (confirmed) {

      /*
       * Inserimos o evento e atualizamos o pedido
       * dentro da mesma transação lógica.
       */

      const result =
        await sql`
          WITH inserted_event AS (

            INSERT INTO pagar_webhook_events (
              event_id,
              event_type,
              payment_id,
              reference,
              payload,
              processed_at,
              created_at
            )
            VALUES (
              ${eventId},
              ${eventType},
              ${paymentId},
              ${reference},
              ${JSON.stringify(event)}::jsonb,
              NOW(),
              NOW()
            )

            ON CONFLICT (event_id)
            DO NOTHING

            RETURNING id
          ),

          updated_order AS (

            UPDATE orders
            SET
              status =
                'PAYMENT_CONFIRMED',

              pagar_payment_id =
                COALESCE(
                  pagar_payment_id,
                  ${paymentId}
                ),

              pagar_event_id =
                ${eventId},

              updated_at =
                NOW()

            WHERE id =
              ${order.id}

            AND status NOT IN (
              'PAYMENT_CONFIRMED',
              'USDT_SENT',
              'COMPLETED'
            )

            AND EXISTS (
              SELECT 1
              FROM inserted_event
            )

            RETURNING
              order_id,
              status,
              amount,
              usdt_amount,
              rate,
              pagar_payment_id
          )

          SELECT
            (
              SELECT id
              FROM inserted_event
              LIMIT 1
            ) AS event_id,

            (
              SELECT row_to_json(updated_order)
              FROM updated_order
              LIMIT 1
            ) AS updated_order
        `;


      const row =
        result[0];


      /*
       * Evento já existia.
       */

      if (
        !row?.event_id
      ) {

        return json(res, 200, {
          success: true,
          duplicate: true,
          event_id: eventId
        });
      }


      let confirmedOrder =
        null;

      if (
        row.updated_order
      ) {
        confirmedOrder =
          row.updated_order;
      }


      return json(res, 200, {

        success: true,

        confirmed: true,

        order: {

          order_id:
            confirmedOrder?.order_id ||
            order.order_id,

          status:
            confirmedOrder?.status ||
            "PAYMENT_CONFIRMED",

          amountMzn:
            Number(
              confirmedOrder?.amount ??
              order.amount
            ),

          usdt_amount:
            confirmedOrder?.usdt_amount ??
            order.usdt_amount,

          rate:
            confirmedOrder?.rate ??
            order.rate
        },

        payment: {

          id:
            paymentId,

          status:
            paymentStatus,

          reference,

          amountMzn,

          currency:
            payment?.currency ||
            "MZN",

          method:
            payment?.method ||
            null,

          providerTransactionId:
            payment?.providerTransactionId ||
            null,

          paidAt:
            payment?.paidAt ||
            null
        }
      });
    }


    /* =====================================================
     * PAGAMENTO FALHOU
     * ===================================================== */

    if (
      eventType ===
      "payment.failed"
    ) {

      const currentStatus =
        String(
          order.status || ""
        )
          .trim()
          .toUpperCase();


      /*
       * Nunca transformar um pagamento já confirmado
       * em FAILED.
       */

      if (
        [
          "PAYMENT_CONFIRMED",
          "USDT_SENT",
          "COMPLETED"
        ].includes(
          currentStatus
        )
      ) {

        await sql`
          INSERT INTO pagar_webhook_events (
            event_id,
            event_type,
            payment_id,
            reference,
            payload,
            processed_at,
            created_at
          )
          VALUES (
            ${eventId},
            ${eventType},
            ${paymentId},
            ${reference},
            ${JSON.stringify(event)}::jsonb,
            NOW(),
            NOW()
          )
          ON CONFLICT (event_id)
          DO NOTHING
        `;

        return json(res, 200, {
          success: true,
          ignored: true,
          order_id:
            order.order_id,
          status:
            order.status
        });
      }


      await sql`
        WITH inserted_event AS (

          INSERT INTO pagar_webhook_events (
            event_id,
            event_type,
            payment_id,
            reference,
            payload,
            processed_at,
            created_at
          )
          VALUES (
            ${eventId},
            ${eventType},
            ${paymentId},
            ${reference},
            ${JSON.stringify(event)}::jsonb,
            NOW(),
            NOW()
          )

          ON CONFLICT (event_id)
          DO NOTHING

          RETURNING id
        )

        UPDATE orders

        SET
          status =
            'FAILED',

          pagar_payment_id =
            COALESCE(
              pagar_payment_id,
              ${paymentId}
            ),

          pagar_event_id =
            ${eventId},

          updated_at =
            NOW()

        WHERE id =
          ${order.id}

        AND status NOT IN (
          'PAYMENT_CONFIRMED',
          'USDT_SENT',
          'COMPLETED'
        )

        AND EXISTS (
          SELECT 1
          FROM inserted_event
        )
      `;


      return json(res, 200, {

        success: true,

        confirmed: false,

        order: {

          order_id:
            order.order_id,

          status:
            "FAILED"
        },

        payment: {

          id:
            paymentId,

          status:
            paymentStatus,

          failureReason:
            payment?.failureReason ||
            null
        }
      });
    }


    /* =====================================================
     * PENDING / PROCESSING / OUTROS
     *
     * NÃO CONFIRMAR.
     * ===================================================== */

    await sql`
      INSERT INTO pagar_webhook_events (
        event_id,
        event_type,
        payment_id,
        reference,
        payload,
        processed_at,
        created_at
      )
      VALUES (
        ${eventId},
        ${eventType || null},
        ${paymentId},
        ${reference},
        ${JSON.stringify(event)}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (event_id)
      DO NOTHING
    `;


    return json(res, 200, {

      success: true,

      confirmed: false,

      pending: true,

      order: {

        order_id:
          order.order_id,

        status:
          order.status
      },

      payment: {

        id:
          paymentId,

        status:
          paymentStatus ||
          "PENDING",

        reference,

        amountMzn
      }
    });


  } catch (error) {

    console.error(
      "USDTMZ PAGAR WEBHOOK ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {

      success: false,

      error:
        "Erro interno ao processar webhook."
    });
  }
}


/* =========================================================
 * VERCEL
 *
 * Precisamos do body bruto para HMAC.
 * ========================================================= */

export const config = {
  api: {
    bodyParser: false
  }
};
