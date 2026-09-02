import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR WEBHOOK
 * POST /api/pagar-webhook
 *
 * TEST / PRODUÇÃO
 *
 * Fluxo:
 *
 * Pagar
 *   ↓
 * POST /api/pagar-webhook
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
 * - Não confirmar pagamento pelo frontend.
 * - Não confiar no status enviado pelo frontend.
 * - O corpo bruto é usado na assinatura.
 * - event_id é único.
 * - Somente payment.succeeded + PAID confirma.
 * - PENDING / PROCESSING não confirmam.
 * - Os secrets ficam somente nas Environment Variables.
 * =========================================================
 */


/* =========================================================
   JSON RESPONSE
========================================================= */

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}


/* =========================================================
   HEADER
========================================================= */

function getHeader(req, name) {
  const lower = name.toLowerCase();

  const value =
    req.headers?.[lower] ??
    req.headers?.[name] ??
    req.headers?.[name.toUpperCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}


/* =========================================================
   RAW BODY
 *
 * Muito importante:
 * O body precisa ser exatamente o corpo recebido.
 *
 * Não usamos JSON.stringify(req.body).
========================================================= */

async function getRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }

  return Buffer.concat(chunks).toString("utf8");
}


/* =========================================================
   CONSTANT-TIME STRING COMPARISON
========================================================= */

function safeCompareHex(receivedHex, expectedHex) {
  if (
    typeof receivedHex !== "string" ||
    typeof expectedHex !== "string"
  ) {
    return false;
  }

  if (
    !/^[a-f0-9]{64}$/i.test(receivedHex) ||
    !/^[a-f0-9]{64}$/i.test(expectedHex)
  ) {
    return false;
  }

  const received =
    Buffer.from(receivedHex, "hex");

  const expected =
    Buffer.from(expectedHex, "hex");

  if (
    received.length !== expected.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    received,
    expected
  );
}


/* =========================================================
   VERIFY PAGAR WEBHOOK
========================================================= */

function verifyWebhook(req, rawBody) {
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


  /* -------------------------------------------------------
     EVENT ID
  ------------------------------------------------------- */

  const eventId =
    getHeader(
      req,
      "pagar-event-id"
    );

  if (!eventId) {
    return {
      ok: false,
      status: 400,
      error:
        "Pagar-Event-Id ausente."
    };
  }


  /* -------------------------------------------------------
     SIGNATURE
  ------------------------------------------------------- */

  const signatureHeader =
    getHeader(
      req,
      "pagar-signature"
    );

  if (!signatureHeader) {
    return {
      ok: false,
      status: 401,
      error:
        "Pagar-Signature ausente."
    };
  }


  /* -------------------------------------------------------
     FORMATO ESPERADO:
     t=TIMESTAMP,v1=SIGNATURE
  ------------------------------------------------------- */

  const parts = {};

  for (
    const item of String(
      signatureHeader
    ).split(",")
  ) {
    const index =
      item.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      item
        .slice(0, index)
        .trim();

    const value =
      item
        .slice(index + 1)
        .trim();

    parts[key] = value;
  }


  const timestamp =
    parts.t;

  const receivedSignature =
    parts.v1;


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


  /* -------------------------------------------------------
     TIMESTAMP
  ------------------------------------------------------- */

  if (
    !/^\d+$/.test(
      timestamp
    )
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "Timestamp inválido."
    };
  }


  /* -------------------------------------------------------
     SIGNATURE HEX
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     EXPIRAÇÃO
     
     Aceitamos até 5 minutos.
  ------------------------------------------------------- */

  const timestampSeconds =
    Number(timestamp) / 1000;

  const age =
    Math.abs(
      Date.now() / 1000 -
      timestampSeconds
    );

  if (
    !Number.isFinite(age) ||
    age > 300
  ) {
    return {
      ok: false,
      status: 401,
      error:
        "Webhook expirado."
    };
  }


  /* -------------------------------------------------------
     ASSINATURA
     
     Pagar:
     
     timestamp + "." + rawBody
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     COMPARAÇÃO SEGURA
  ------------------------------------------------------- */

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
    eventId: String(eventId)
  };
}


/* =========================================================
   EVENT TYPE
========================================================= */

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
   PAYMENT
========================================================= */

function getPayment(event) {
  return (
    event?.payment ||
    event?.data?.payment ||
    event?.data ||
    {}
  );
}


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(req, res) {

  /* =======================================================
     METHOD
  ======================================================= */

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
     ENV
  ======================================================= */

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
       RAW BODY
    ===================================================== */

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
       VERIFY
    ===================================================== */

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
       JSON
    ===================================================== */

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
       EVENT
    ===================================================== */

    const eventType =
      getEventType(event);


    const payment =
      getPayment(event);


    /* =====================================================
       PAYMENT DATA
    ===================================================== */

    const paymentId =
      payment?.id
        ? String(payment.id)
        : null;


    const reference =
      payment?.reference
        ? String(payment.reference)
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
       DATABASE
    ===================================================== */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /* =====================================================
       EVENT JÁ PROCESSADO?
    ===================================================== */

    const existing =
      await sql`
        SELECT
          id,
          processed_at
        FROM pagar_webhook_events
        WHERE event_id = ${eventId}
        LIMIT 1
      `;


    if (existing.length > 0) {

      return json(res, 200, {
        success: true,
        duplicate: true,
        event_id: eventId
      });
    }


    /* =====================================================
       EVENTO NÃO É PAYMENT
    ===================================================== */

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
       PAYMENT PRECISA TER ID OU REFERENCE
    ===================================================== */

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
       LOCALIZAR PEDIDO
    ===================================================== */

    let orders = [];


    /* -----------------------------------------------------
       PRIMEIRO POR REFERENCE
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       DEPOIS POR PAYMENT ID
    ----------------------------------------------------- */

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
       PEDIDO NÃO ENCONTRADO
    ===================================================== */

    if (orders.length === 0) {

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
       VALIDAR PAYMENT ID
    ===================================================== */

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
       VALIDAR REFERENCE
    ===================================================== */

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
       VALIDAR AMOUNT
    ===================================================== */

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
       CONFIRMADO
       
       Somente:
       
       payment.succeeded
       +
       PAID
    ===================================================== */

    const confirmed =
      eventType ===
        "payment.succeeded" &&
      paymentStatus ===
        "PAID";


    if (confirmed) {

      /*
       * Evento e alteração do pedido
       * acontecem na mesma transação.
       */

      const [
        eventInsert,
        orderUpdate
      ] = await sql.transaction([

        /* -------------------------------------------------
           EVENT
        ------------------------------------------------- */

        sql`
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
          RETURNING
            id,
            event_id
        `,

        /* -------------------------------------------------
           ORDER
        ------------------------------------------------- */

        sql`
          UPDATE orders
          SET
            status = 'PAYMENT_CONFIRMED',

            pagar_payment_id =
              COALESCE(
                pagar_payment_id,
                ${paymentId}
              ),

            pagar_event_id =
              ${eventId},

            updated_at =
              NOW()

          WHERE id = ${order.id}

          AND status NOT IN (
            'PAYMENT_CONFIRMED',
            'USDT_SENT',
            'COMPLETED'
          )

          RETURNING
            order_id,
            status,
            amount,
            usdt_amount,
            rate,
            pagar_payment_id
        `
      ]);


      /* ---------------------------------------------------
         DUPLICATE
      --------------------------------------------------- */

      if (
        eventInsert.length === 0
      ) {

        return json(res, 200, {
          success: true,
          duplicate: true,
          event_id: eventId
        });
      }


      const confirmedOrder =
        orderUpdate[0];


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
            null,

          receipt:
            payment?.receipt ||
            null
        }
      });
    }


    /* =====================================================
       PAYMENT FAILED
    ===================================================== */

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


      /* ---------------------------------------------------
         NÃO ALTERAR PEDIDOS JÁ CONFIRMADOS
      --------------------------------------------------- */

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


      /* ---------------------------------------------------
         EVENT + ORDER
      --------------------------------------------------- */

      const [
        eventInsert,
        orderUpdate
      ] = await sql.transaction([

        sql`
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
          RETURNING
            id,
            event_id
        `,

        sql`
          UPDATE orders
          SET
            status = 'FAILED',

            pagar_payment_id =
              COALESCE(
                pagar_payment_id,
                ${paymentId}
              ),

            pagar_event_id =
              ${eventId},

            updated_at =
              NOW()

          WHERE id = ${order.id}

          AND status NOT IN (
            'PAYMENT_CONFIRMED',
            'USDT_SENT',
            'COMPLETED'
          )

          RETURNING
            order_id,
            status
        `
      ]);


      if (
        eventInsert.length === 0
      ) {

        return json(res, 200, {
          success: true,
          duplicate: true,
          event_id: eventId
        });
      }


      return json(res, 200, {

        success: true,

        confirmed: false,

        order: {

          order_id:
            orderUpdate[0]?.order_id ||
            order.order_id,

          status:
            orderUpdate[0]?.status ||
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
       PENDING / PROCESSING / OUTROS
       
       Não confirma pagamento.
    ===================================================== */

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
   VERCEL
 *
 * Necessário para receber o corpo sem o body parser.
========================================================= */

export const config = {
  api: {
    bodyParser: false
  }
};
