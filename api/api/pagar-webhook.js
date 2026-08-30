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
 * payment.succeeded
 *   ↓
 * /api/pagar-webhook
 *   ↓
 * validar assinatura
 *   ↓
 * validar evento
 *   ↓
 * localizar order_id/reference
 *   ↓
 * confirmar valor
 *   ↓
 * PAYMENT_CONFIRMED
 *
 * IMPORTANTE:
 * - O webhook NÃO confia no frontend.
 * - HTTP 202 do /api/payment NÃO confirma pagamento.
 * - Somente evento final PAID/payment.succeeded confirma.
 * - Eventos repetidos não podem processar o pedido duas vezes.
 * - PAGAR_WEBHOOK_SECRET fica somente no servidor.
 * =========================================================
 */


/* =========================================================
   JSON
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
   RAW BODY
========================================================= */

function getRawBody(req) {

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (typeof req.body === "string") {
    return req.body;
  }

  /*
   * Atenção:
   * JSON.stringify é apenas fallback.
   *
   * Para HMAC correto, o ideal é que a Vercel
   * entregue o body bruto.
   */

  return JSON.stringify(
    req.body || {}
  );
}


/* =========================================================
   VALIDAR WEBHOOK PAGAR
========================================================= */

function verifyWebhook(
  req,
  rawBody
) {

  const secret =
    process.env.PAGAR_WEBHOOK_SECRET;

  if (!secret) {

    throw new Error(
      "PAGAR_WEBHOOK_SECRET não configurado."
    );
  }


  const eventId =
    req.headers["pagar-event-id"];


  const signatureHeader =
    req.headers["pagar-signature"] ||
    "";


  if (!eventId) {

    return {
      ok: false,
      status: 400,
      error:
        "Pagar-Event-Id ausente."
    };
  }


  /*
   * Exemplo:
   *
   * t=1750000000000,v1=abcdef...
   */

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

    parts[key] =
      value;
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


  /*
   * Timestamp deve ser numérico.
   */

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


  /*
   * HMAC SHA-256 = 64 caracteres hex.
   */

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


  /*
   * Evitar replay de webhook antigo.
   *
   * Pagar usa timestamp em milissegundos.
   */

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


  /*
   * Assinatura oficial:
   *
   * timestamp + "." + rawBody
   */

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(
        `${timestamp}.${rawBody}`,
        "utf8"
      )
      .digest("hex");


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

    return {
      ok: false,
      status: 401,
      error:
        "Assinatura inválida."
    };
  }


  if (
    !crypto.timingSafeEqual(
      received,
      expected
    )
  ) {

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
      String(eventId)
  };
}


/* =========================================================
   EXTRAIR PAGAMENTO
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
   NORMALIZAR EVENT TYPE
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
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  /*
   * -------------------------------------------------------
   * SOMENTE POST
   * -------------------------------------------------------
   */

  if (
    req.method !== "POST"
  ) {

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


  /*
   * -------------------------------------------------------
   * DATABASE
   * -------------------------------------------------------
   */

  if (
    !process.env.DATABASE_URL
  ) {

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


  /*
   * -------------------------------------------------------
   * WEBHOOK SECRET
   * -------------------------------------------------------
   */

  if (
    !process.env.PAGAR_WEBHOOK_SECRET
  ) {

    return json(
      res,
      500,
      {
        success: false,
        error:
          "PAGAR_WEBHOOK_SECRET não configurado."
      }
    );
  }


  try {

    /*
     * -----------------------------------------------------
     * RAW BODY
     * -----------------------------------------------------
     */

    const rawBody =
      getRawBody(req);


    /*
     * -----------------------------------------------------
     * VALIDAR ASSINATURA
     * -----------------------------------------------------
     */

    const verification =
      verifyWebhook(
        req,
        rawBody
      );


    if (
      !verification.ok
    ) {

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


    /*
     * -----------------------------------------------------
     * PARSE JSON
     * -----------------------------------------------------
     */

    let event;

    try {

      event =
        JSON.parse(
          rawBody
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
     * EVENT TYPE
     * -----------------------------------------------------
     */

    const eventType =
      getEventType(event);


    /*
     * -----------------------------------------------------
     * IGNORAR EVENTOS QUE NÃO SÃO PAGAMENTOS
     * -----------------------------------------------------
     */

    if (
      !eventType.startsWith(
        "payment."
      )
    ) {

      return json(
        res,
        200,
        {
          success: true,
          ignored: true,
          event:
            eventType ||
            null
        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAYMENT
     * -----------------------------------------------------
     */

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
          )
        : null;


    const paymentStatus =
      String(
        payment?.status ||
        ""
      )
        .trim()
        .toUpperCase();


    const amountMzn =
      Number(
        payment?.amountMzn
      );


    /*
     * -----------------------------------------------------
     * VALIDAR IDENTIFICADORES
     * -----------------------------------------------------
     */

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
            "Pagamento sem ID ou reference."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * DATABASE CLIENT
     * -----------------------------------------------------
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * -----------------------------------------------------
     * REGISTAR EVENTO
     *
     * A tabela precisa de UNIQUE(event_id).
     * -----------------------------------------------------
     */

    const inserted =
      await sql`

      INSERT INTO pagar_webhook_events (

        event_id,
        event_type,
        payment_id,
        reference,
        received_at

      )

      VALUES (

        ${eventId},
        ${eventType},
        ${paymentId},
        ${reference},
        NOW()

      )

      ON CONFLICT (
        event_id
      )

      DO NOTHING

      RETURNING event_id

    `;


    /*
     * -----------------------------------------------------
     * WEBHOOK DUPLICADO
     * -----------------------------------------------------
     */

    if (
      inserted.length === 0
    ) {

      return json(
        res,
        200,
        {
          success: true,
          duplicate: true,
          event_id:
            eventId
        }
      );
    }


    /*
     * -----------------------------------------------------
     * LOCALIZAR PEDIDO
     *
     * Primeiro por reference.
     * Se não houver, usa payment ID.
     * -----------------------------------------------------
     */

    let orders;


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
          pagar_payment_id,
          blockchain_tx_hash,
          wallet_address

        FROM orders

        WHERE order_id =
          ${reference}

        LIMIT 1

      `;

    } else {

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
          pagar_payment_id,
          blockchain_tx_hash,
          wallet_address

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

      console.error(
        "USDTMZ PAGAR WEBHOOK: pedido não encontrado",
        {
          eventId,
          eventType,
          paymentId,
          reference
        }
      );


      /*
       * Retornamos 200 porque o evento já foi
       * registado e não queremos provocar retries
       * infinitos para um pedido inexistente.
       */

      return json(
        res,
        200,
        {
          success: true,
          orderFound: false,
          event_id:
            eventId
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
     * Se o pedido já tem payment ID, o webhook
     * precisa corresponder ao mesmo pagamento.
     */

    if (
      order.pagar_payment_id &&
      paymentId &&
      String(
        order.pagar_payment_id
      ) !== paymentId
    ) {

      console.error(
        "USDTMZ PAGAR WEBHOOK: payment ID incompatível",
        {
          orderId:
            order.order_id,
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
            "payment.id não corresponde ao pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR REFERÊNCIA
     * -----------------------------------------------------
     */

    if (
      reference &&
      String(
        order.order_id
      ) !== reference
    ) {

      return json(
        res,
        409,
        {
          success: false,
          error:
            "Reference não corresponde ao pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * VALIDAR VALOR
     * -----------------------------------------------------
     */

    const orderAmount =
      Number(
        order.amount
      );


    if (
      !Number.isFinite(
        amountMzn
      )
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Pagamento sem amountMzn válido."
        }
      );
    }


    if (
      amountMzn !==
      orderAmount
    ) {

      console.error(
        "USDTMZ PAGAR WEBHOOK: valor incompatível",
        {
          orderId:
            order.order_id,
          expected:
            orderAmount,
          received:
            amountMzn
        }
      );


      return json(
        res,
        409,
        {
          success: false,
          error:
            "O valor pago não corresponde ao valor do pedido."
        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAGAMENTO CONFIRMADO
     *
     * A Pagar documenta payment.succeeded como
     * confirmação final.
     *
     * Também verificamos status PAID.
     * -----------------------------------------------------
     */

    const confirmed =
      eventType ===
        "payment.succeeded" &&
      paymentStatus ===
        "PAID";


    /*
     * -----------------------------------------------------
     * PAYMENT SUCCEEDED
     * -----------------------------------------------------
     */

    if (confirmed) {

      /*
       * Nunca substituir um pedido já concluído.
       */

      if (
        [
          "USDT_SENT",
          "COMPLETED"
        ].includes(
          String(
            order.status
          ).toUpperCase()
        )
      ) {

        return json(
          res,
          200,
          {
            success: true,
            alreadyProcessed: true,
            order_id:
              order.order_id,
            status:
              order.status
          }
        );
      }


      /*
       * Confirmar pagamento.
       *
       * A condição WHERE evita regressão
       * de estado em pedidos já confirmados.
       */

      const updated =
        await sql`

        UPDATE orders

        SET

          status =
            'PAYMENT_CONFIRMED',

          pagar_payment_id =
            COALESCE(
              pagar_payment_id,
              ${paymentId}
            ),

          updated_at =
            NOW()

        WHERE id =
          ${order.id}

          AND status NOT IN (
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

      `;


      const confirmedOrder =
        updated[0];


      /*
       * ---------------------------------------------------
       * RESPOSTA
       * ---------------------------------------------------
       */

      return json(
        res,
        200,
        {
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
                confirmedOrder?.amount ||
                order.amount
              ),

            usdt_amount:
              confirmedOrder?.usdt_amount ||
              order.usdt_amount,

            rate:
              confirmedOrder?.rate ||
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

        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAYMENT FAILED
     * -----------------------------------------------------
     */

    if (
      eventType ===
      "payment.failed"
    ) {

      /*
       * Não alterar um pedido que já foi confirmado.
       */

      const currentStatus =
        String(
          order.status ||
          ""
        ).toUpperCase();


      if (
        [
          "PAYMENT_CONFIRMED",
          "USDT_SENT",
          "COMPLETED"
        ].includes(
          currentStatus
        )
      ) {

        return json(
          res,
          200,
          {
            success: true,
            ignored: true,
            reason:
              "Pedido já confirmado ou concluído.",
            order_id:
              order.order_id,
            status:
              order.status
          }
        );
      }


      await sql`

        UPDATE orders

        SET

          status =
            'FAILED',

          pagar_payment_id =
            COALESCE(
              pagar_payment_id,
              ${paymentId}
            ),

          updated_at =
            NOW()

        WHERE id =
          ${order.id}

      `;


      return json(
        res,
        200,
        {
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

        }
      );
    }


    /*
     * -----------------------------------------------------
     * PAYMENT AINDA NÃO FINALIZADO
     *
     * PENDING / PROCESSING não entregam nada.
     * -----------------------------------------------------
     */

    return json(
      res,
      200,
      {
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
