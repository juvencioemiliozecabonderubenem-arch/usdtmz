import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — PAGAR WEBHOOK
 * =========================================================
 *
 * Recebe confirmações finais da Pagar.
 *
 * URL:
 * POST /api/pagar-webhook
 *
 * IMPORTANTE:
 * - Nunca confiar apenas no status enviado pelo frontend.
 * - Validar sempre a assinatura do webhook.
 * - PAID só é aplicado depois de webhook válido.
 * - Webhooks repetidos não podem creditar o mesmo pedido duas vezes.
 */

const WEBHOOK_SECRET =
  process.env.PAGAR_WEBHOOK_SECRET;


/*
 * =========================================================
 * RESPOSTA
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
 * LER BODY RAW
 * =========================================================
 *
 * Precisamos do body original para validar HMAC.
 */

async function readRawBody(req) {

  /*
   * Vercel normalmente disponibiliza req.body.
   * Quando já for Buffer, usamos diretamente.
   */

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }


  /*
   * Caso seja string.
   */

  if (typeof req.body === "string") {

    return Buffer.from(
      req.body,
      "utf8"
    );

  }


  /*
   * Em alguns ambientes o body pode chegar
   * como objeto. Isso não é ideal para HMAC,
   * mas fazemos fallback para evitar quebra.
   */

  if (
    req.body &&
    typeof req.body === "object"
  ) {

    return Buffer.from(
      JSON.stringify(req.body),
      "utf8"
    );

  }


  /*
   * Último fallback.
   */

  return Buffer.from(
    "",
    "utf8"
  );
}


/*
 * =========================================================
 * PARSE DA ASSINATURA
 * =========================================================
 *
 * Esperado:
 *
 * t=timestamp,v1=assinatura
 */

function parseSignatureHeader(
  header
) {

  const result = {};

  const parts =
    String(header || "")
      .split(",");

  for (const part of parts) {

    const separator =
      part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key =
      part
        .slice(0, separator)
        .trim();

    const value =
      part
        .slice(separator + 1)
        .trim();

    if (key) {
      result[key] = value;
    }

  }

  return result;
}


/*
 * =========================================================
 * VALIDAR HMAC
 * =========================================================
 */

function verifyWebhookSignature(
  rawBody,
  signatureHeader
) {

  if (!WEBHOOK_SECRET) {
    throw new Error(
      "PAGAR_WEBHOOK_SECRET não configurado."
    );
  }


  const parsed =
    parseSignatureHeader(
      signatureHeader
    );


  const timestamp =
    parsed.t;

  const received =
    parsed.v1;


  /*
   * Timestamp obrigatório.
   */

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp)
  ) {

    return false;

  }


  /*
   * Assinatura hexadecimal SHA-256.
   */

  if (
    !received ||
    !/^[a-f0-9]{64}$/i.test(received)
  ) {

    return false;

  }


  /*
   * Impede replay antigo.
   */

  const timestampSeconds =
    Number(timestamp);


  if (
    !Number.isFinite(
      timestampSeconds
    )
  ) {

    return false;

  }


  const nowSeconds =
    Date.now() / 1000;


  if (
    Math.abs(
      nowSeconds -
      timestampSeconds
    ) > 300
  ) {

    return false;

  }


  /*
   * Corpo original.
   */

  const bodyText =
    rawBody.toString("utf8");


  /*
   * Mesmo formato indicado pela Pagar:
   *
   * timestamp + "." + rawBody
   */

  const expected =
    crypto
      .createHmac(
        "sha256",
        WEBHOOK_SECRET
      )
      .update(
        timestamp +
        "." +
        bodyText
      )
      .digest("hex");


  /*
   * Comparação segura.
   */

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
     * BODY RAW
     * -----------------------------------------------------
     */

    const rawBody =
      await readRawBody(req);


    /*
     * -----------------------------------------------------
     * ASSINATURA
     * -----------------------------------------------------
     */

    const signatureHeader =
      req.headers[
        "pagar-signature"
      ] || "";


    const valid =
      verifyWebhookSignature(
        rawBody,
        signatureHeader
      );


    if (!valid) {

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
     * EVENT ID
     * -----------------------------------------------------
     */

    const eventId =
      req.headers[
        "pagar-event-id"
      ];


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
     * JSON
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
            "Webhook JSON inválido."
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
     * EVENT TYPE
     * -----------------------------------------------------
     */

    const eventType =
      String(
        event?.type ||
        event?.event ||
        ""
      ).trim();


    /*
     * -----------------------------------------------------
     * ACEITAR APENAS EVENTOS DE PAGAMENTO
     * -----------------------------------------------------
     *
     * Outros eventos podem existir na Pagar,
     * mas esta rota não os aplica à orders.
     */

    if (
      eventType !==
      "payment.succeeded" &&

      eventType !==
      "payment.failed"
    ) {

      /*
       * Evento válido, mas não destinado
       * ao fluxo de orders.
       */

      return json(
        res,
        200,
        {
          success: true,
          ignored: true,
          eventId,
          eventType
        }
      );

    }


    /*
     * -----------------------------------------------------
     * EXTRAIR PAYMENT
     * -----------------------------------------------------
     */

    const payment =
      event?.payment ||
      event?.data?.payment ||
      event?.data ||
      null;


    if (!payment) {

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
     * PAYMENT ID
     * -----------------------------------------------------
     */

    const paymentId =
      payment.id
        ? String(
            payment.id
          )
        : null;


    /*
     * -----------------------------------------------------
     * REFERENCE
     * -----------------------------------------------------
     */

    const reference =
      payment.reference
        ? String(
            payment.reference
          ).trim()
        : "";


    if (!reference) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Reference do pagamento ausente."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * STATUS
     * -----------------------------------------------------
     */

    const paymentStatus =
      String(
        payment.status ||
        ""
      ).toUpperCase();


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
          emola_transaction_id,
          pagar_payment_id

        FROM orders

        WHERE order_id =
          ${reference}

        LIMIT 1

      `;


    if (orders.length === 0) {

      /*
       * Não devolver erro transitório.
       * A Pagar poderia repetir o evento.
       */

      console.warn(
        "PAGAR WEBHOOK: order não encontrado:",
        reference
      );

      return json(
        res,
        200,
        {
          success: true,
          processed: false,
          reason:
            "Pedido não encontrado.",
          eventId
        }
      );

    }


    const order =
      orders[0];


    /*
     * -----------------------------------------------------
     * PAYMENT ID
     * -----------------------------------------------------
     *
     * Se já temos o mesmo payment ID,
     * o evento já foi aplicado.
     */

    if (
      paymentId &&
      order.pagar_payment_id ===
        paymentId
    ) {

      return json(
        res,
        200,
        {
          success: true,
          duplicate: true,
          eventId,
          paymentId
        }
      );

    }


    /*
     * -----------------------------------------------------
     * TRANSACTION ID
     * -----------------------------------------------------
     */

    const providerTransactionId =
      payment.providerTransactionId
        ? String(
            payment.providerTransactionId
          )
        : null;


    /*
     * -----------------------------------------------------
     * MÉTODO
     * -----------------------------------------------------
     */

    const method =
      String(
        payment.method ||
        order.payment ||
        ""
      ).toUpperCase();


    /*
     * =====================================================
     * PAGAMENTO APROVADO
     * =====================================================
     */

    if (
      eventType ===
        "payment.succeeded" &&

      paymentStatus ===
        "PAID"
    ) {

      /*
       * Não alterar um pedido já processado.
       */

      if (
        String(
          order.status || ""
        ).toUpperCase() ===
        "PAID"
      ) {

        /*
         * Apenas guardamos o payment ID
         * caso ainda esteja vazio.
         */

        if (
          paymentId &&
          !order.pagar_payment_id
        ) {

          await sql`

            UPDATE orders

            SET

              pagar_payment_id =
                ${paymentId},

              updated_at =
                NOW()

            WHERE order_id =
              ${reference}

          `;

        }


        return json(
          res,
          200,
          {
            success: true,
            alreadyPaid: true,
            eventId,
            paymentId
          }
        );

      }


      /*
       * Atualização transacional lógica:
       *
       * PAID somente se ainda não estiver PAID.
       */

      if (
        method ===
        "MPESA"
      ) {

        await sql`

          UPDATE orders

          SET

            status = 'PAID',

            payment =
              'MPESA',

            pagar_payment_id =
              ${paymentId},

            mpesa_transaction_id =
              COALESCE(
                ${providerTransactionId},
                mpesa_transaction_id
              ),

            updated_at =
              NOW()

          WHERE order_id =
            ${reference}

            AND status <>
              'PAID'

        `;

      } else if (
        method ===
        "EMOLA"
      ) {

        await sql`

          UPDATE orders

          SET

            status = 'PAID',

            payment =
              'EMOLA',

            pagar_payment_id =
              ${paymentId},

            emola_transaction_id =
              COALESCE(
                ${providerTransactionId},
                emola_transaction_id
              ),

            updated_at =
              NOW()

          WHERE order_id =
            ${reference}

            AND status <>
              'PAID'

        `;

      } else {

        await sql`

          UPDATE orders

          SET

            status = 'PAID',

            pagar_payment_id =
              ${paymentId},

            updated_at =
              NOW()

          WHERE order_id =
            ${reference}

            AND status <>
              'PAID'

        `;

      }


      console.log(
        "PAGAR WEBHOOK: pagamento confirmado",
        {
          eventId,
          paymentId,
          reference,
          method
        }
      );


      return json(
        res,
        200,
        {
          success: true,
          processed: true,
          status: "PAID",
          eventId,
          paymentId,
          orderId:
            reference
        }
      );

    }


    /*
     * =====================================================
     * PAGAMENTO FALHOU
     * =====================================================
     */

    if (
      eventType ===
        "payment.failed"
    ) {

      /*
       * Não transformar PAID em FAILED.
       */

      if (
        String(
          order.status || ""
        ).toUpperCase() ===
        "PAID"
      ) {

        return json(
          res,
          200,
          {
            success: true,
            ignored: true,
            reason:
              "Pedido já está PAID.",
            eventId,
            paymentId
          }
        );

      }


      await sql`

        UPDATE orders

        SET

          status = 'FAILED',

          pagar_payment_id =
            ${paymentId},

          updated_at =
            NOW()

        WHERE order_id =
          ${reference}

          AND status <>
            'PAID'

      `;


      console.log(
        "PAGAR WEBHOOK: pagamento falhou",
        {
          eventId,
          paymentId,
          reference
        }
      );


      return json(
        res,
        200,
        {
          success: true,
          processed: true,
          status: "FAILED",
          eventId,
          paymentId,
          orderId:
            reference
        }
      );

    }


    /*
     * -----------------------------------------------------
     * FALLBACK
     * -----------------------------------------------------
     */

    return json(
      res,
      200,
      {
        success: true,
        processed: false,
        eventId
      }
    );


  } catch (error) {

    console.error(
      "USDTMZ PAGAR WEBHOOK ERROR:",
      error?.message ||
      error
    );


    /*
     * 500 faz a Pagar poder tentar novamente
     * quando o erro for temporário.
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
