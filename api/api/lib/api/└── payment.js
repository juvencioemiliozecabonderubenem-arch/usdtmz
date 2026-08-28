import { neon } from "@neondatabase/serverless";
import { pagarPost } from "../lib/pagar.js";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function normalizePaymentMethod(value) {
  const method =
    String(value || "")
      .trim()
      .toLowerCase();

  if (method === "mpesa") {
    return "MPESA";
  }

  if (method === "emola") {
    return "EMOLA";
  }

  return null;
}

function normalizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

function isValidMozambiquePhone(phone) {
  return /^(?:258)?(?:8[2-7]\d{7})$/.test(phone);
}

function buildIdempotencyKey(orderId) {
  return `payment:${orderId}`;
}

export default async function handler(req, res) {

  /*
   * =========================
   * MÉTODO
   * =========================
   */

  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  /*
   * =========================
   * DATABASE
   * =========================
   */

  if (!process.env.DATABASE_URL) {
    return json(res, 500, {
      success: false,
      error:
        "DATABASE_URL não configurada no Vercel."
    });
  }

  try {

    const sql =
      neon(process.env.DATABASE_URL);

    /*
     * =========================
     * DADOS
     * =========================
     */

    const body =
      req.body || {};

    const orderId =
      String(
        body.order_id ||
        body.orderId ||
        ""
      ).trim();

    const paymentMethod =
      normalizePaymentMethod(
        body.payment_method ||
        body.payment
      );

    /*
     * O telefone pode ser enviado
     * pelo frontend, mas o pedido
     * existente continua sendo a
     * fonte principal dos dados.
     */

    const requestedPhone =
      normalizePhone(
        body.phone
      );

    /*
     * =========================
     * VALIDAR ORDER ID
     * =========================
     */

    if (!orderId) {
      return json(res, 400, {
        success: false,
        error:
          "order_id é obrigatório."
      });
    }

    /*
     * =========================
     * LOCALIZAR PEDIDO
     * =========================
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
          pagar_payment_id,
          mpesa_transaction_id,
          emola_transaction_id,
          created_at,
          updated_at

        FROM orders

        WHERE order_id = ${orderId}

        LIMIT 1

      `;

    if (orders.length === 0) {
      return json(res, 404, {
        success: false,
        error:
          "Pedido não encontrado."
      });
    }

    const order =
      orders[0];

    /*
     * =========================
     * VALIDAR OPERAÇÃO
     * =========================
     */

    if (order.operation !== "buy") {
      return json(res, 400, {
        success: false,
        error:
          "Este pedido não é uma compra de USDT."
      });
    }

    /*
     * =========================
     * JÁ CONFIRMADO?
     * =========================
     */

    if (
      order.status ===
      "PAYMENT_CONFIRMED"
      ||
      order.status ===
      "USDT_SENT"
      ||
      order.status ===
      "COMPLETED"
    ) {

      return json(res, 409, {
        success: false,
        error:
          "Este pedido já possui pagamento confirmado ou concluído.",
        order: {
          order_id:
            order.order_id,
          status:
            order.status,
          pagar_payment_id:
            order.pagar_payment_id
        }
      });

    }

    /*
     * =========================
     * PAGAMENTO JÁ CRIADO
     * =========================
     *
     * Não criamos outra cobrança
     * enquanto existir uma tentativa
     * ainda não concluída.
     */

    if (
      order.pagar_payment_id &&
      (
        order.status === "PENDING" ||
        order.status === "PROCESSING"
      )
    ) {

      return json(res, 409, {
        success: false,
        error:
          "Já existe uma tentativa de pagamento para este pedido.",
        payment: {
          id:
            order.pagar_payment_id,
          status:
            order.status
        }
      });

    }

    /*
     * =========================
     * MÉTODO
     * =========================
     */

    const method =
      paymentMethod ||
      normalizePaymentMethod(
        order.payment
      );

    if (!method) {
      return json(res, 400, {
        success: false,
        error:
          "Escolha M-Pesa ou e-Mola."
      });
    }

    /*
     * =========================
     * TELEFONE
     * =========================
     */

    const payerPhone =
      requestedPhone ||
      normalizePhone(
        order.phone
      );

    if (
      !isValidMozambiquePhone(
        payerPhone
      )
    ) {

      return json(res, 400, {
        success: false,
        error:
          "Número de telefone de Moçambique inválido."
      });

    }

    /*
     * =========================
     * VALOR
     * =========================
     *
     * O valor vem da BD.
     * Nunca confiamos no valor
     * enviado pelo frontend.
     */

    const amountMzn =
      Number(order.amount);

    if (
      !Number.isInteger(amountMzn) ||
      amountMzn < 20 ||
      amountMzn > 40000
    ) {

      return json(res, 400, {
        success: false,
        error:
          "O valor do pedido deve ser um número inteiro entre 20 e 40.000 MZN."
      });

    }

    /*
     * =========================
     * REFERÊNCIA
     * =========================
     */

    const reference =
      order.order_id;

    /*
     * =========================
     * BODY PAGAR
     * =========================
     */

    const paymentBody = {

      reference,

      title:
        "Compra de USDTMZ",

      description:
        `Compra de ${Number(
          order.usdt_amount
        ).toFixed(6)} USDT`,

      amountMzn,

      method,

      payerPhone

    };

    /*
     * =========================
     * IDEMPOTÊNCIA
     * =========================
     */

    const idempotencyKey =
      buildIdempotencyKey(
        order.order_id
      );

    /*
     * =========================
     * ATUALIZAR PROCESSING
     * =========================
     */

    await sql`

      UPDATE orders

      SET
        status = 'PENDING',
        payment = ${method},
        updated_at = CURRENT_TIMESTAMP

      WHERE order_id =
        ${order.order_id}

    `;

    /*
     * =========================
     * CRIAR PAGAMENTO
     * =========================
     */

    let result;

    try {

      result =
        await pagarPost(
          "/payments",
          paymentBody,
          idempotencyKey
        );

    } catch (error) {

      console.error(
        "PAGAR PAYMENT ERROR:",
        {
          message:
            error?.message,
          code:
            error?.code,
          requestId:
            error?.requestId,
          httpStatus:
            error?.httpStatus
        }
      );

      /*
       * Erros 5xx/rede podem deixar
       * o resultado financeiro incerto.
       *
       * Não marcamos FAILED
       * automaticamente.
       */

      if (
        error?.httpStatus >= 500 ||
        !error?.httpStatus
      ) {

        return json(res, 502, {
          success: false,
          error:
            "Não foi possível confirmar a resposta da Pagar. O estado do pagamento deve ser reconciliado antes de tentar novamente.",
          requestId:
            error?.requestId || null
        });

      }

      return json(res, 502, {
        success: false,
        error:
          error?.message ||
          "A Pagar rejeitou o pedido.",
        requestId:
          error?.requestId || null
      });

    }

    /*
     * =========================
     * VALIDAR RESPOSTA
     * =========================
     */

    const payment =
      result?.payment;

    if (!payment?.id) {

      console.error(
        "PAGAR INVALID PAYMENT RESPONSE:",
        result
      );

      return json(res, 502, {
        success: false,
        error:
          "A Pagar não devolveu um identificador de pagamento válido."
      });

    }

    /*
     * =========================
     * STATUS
     * =========================
     */

    const pagarStatus =
      String(
        payment.status ||
        "PROCESSING"
      ).toUpperCase();

    /*
     * No nosso banco, o pagamento
     * ainda não está confirmado.
     *
     * PAYMENT_CONFIRMED só será
     * usado pelo webhook/reconciliação.
     */

    const localStatus =
      (
        pagarStatus ===
        "PAID"
      )
        ? "PAYMENT_CONFIRMED"
        : "PENDING";

    /*
     * =========================
     * TRANSACTION IDs
     * =========================
     */

    const providerTransactionId =
      payment.providerTransactionId ||
      null;

    /*
     * =========================
     * ATUALIZAR ORDER
     * =========================
     */

    await sql`

      UPDATE orders

      SET

        pagar_payment_id =
          ${String(payment.id)},

        status =
          ${localStatus},

        payment =
          ${method},

        phone =
          ${payerPhone},

        mpesa_transaction_id =
          ${
            method === "MPESA"
              ? providerTransactionId
              : order.mpesa_transaction_id
          },

        emola_transaction_id =
          ${
            method === "EMOLA"
              ? providerTransactionId
              : order.emola_transaction_id
          },

        updated_at =
          CURRENT_TIMESTAMP

      WHERE order_id =
        ${order.order_id}

    `;

    /*
     * =========================
     * RESPOSTA
     * =========================
     */

    return json(res, 202, {

      success: true,

      message:
        "Pagamento enviado para processamento. A confirmação será feita pela Pagar.",

      order: {

        order_id:
          order.order_id,

        status:
          localStatus,

        amount:
          amountMzn,

        usdt_amount:
          Number(
            order.usdt_amount
          ).toFixed(6),

        rate:
          Number(
            order.rate
          )

      },

      payment: {

        id:
          payment.id,

        status:
          pagarStatus,

        method:
          payment.method ||
          method,

        amountMzn:
          payment.amountMzn ??
          amountMzn,

        currency:
          payment.currency ||
          "MZN",

        reference:
          payment.reference ||
          reference,

        providerTransactionId:
          providerTransactionId,

        paidAt:
          payment.paidAt ||
          null

      }

    });

  } catch (error) {

    console.error(
      "USDTMZ PAYMENT ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno ao iniciar o pagamento."
    });

  }
}
