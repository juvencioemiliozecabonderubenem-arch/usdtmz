import { neon } from "@neondatabase/serverless";

/*
 * =========================================================
 * USDTMZ — API DE PEDIDOS
 * POST /api/pedido
 *
 * TAXA:
 * 1 USDT = 50 MZN
 *
 * EXEMPLO:
 * 1000 MZN = 20 USDT
 *
 * FORMATO DA CONVERSÃO:
 * 1000-20 USDT
 *
 * IMPORTANTE:
 * - A taxa é definida no servidor.
 * - O frontend não pode alterar a taxa.
 * - O USDT é calculado no servidor.
 * - O pedido começa como PENDING.
 * - Esta API NÃO chama a Pagar.
 * =========================================================
 */

const RATE = 50;

const MIN_AMOUNT_MZN = 20;
const MAX_AMOUNT_MZN = 40000;


/* =========================================================
   RESPOSTA JSON
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
   NORMALIZAR MÉTODO DE PAGAMENTO
========================================================= */

function normalizePayment(value) {

  const payment =
    String(value || "")
      .trim()
      .toLowerCase();

  if (payment === "mpesa") {
    return "MPESA";
  }

  if (payment === "emola") {
    return "EMOLA";
  }

  return null;
}


/* =========================================================
   NORMALIZAR TELEFONE
========================================================= */

function normalizePhone(value) {

  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}


/* =========================================================
   GERAR ID DO PEDIDO
========================================================= */

function generateOrderId() {

  const random =
    Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();

  return (
    "USDTMZ-" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    "-" +
    random
  );
}


/* =========================================================
   POST — CRIAR PEDIDO
========================================================= */

async function createOrder(
  req,
  res,
  sql
) {

  const body =
    req.body || {};


  /* =======================================================
     NOME
  ======================================================= */

  const name =
    String(
      body.name || "Cliente"
    ).trim();

  if (name.length > 100) {

    return json(res, 400, {

      success: false,

      error:
        "Nome demasiado longo."

    });
  }


  /* =======================================================
     TELEFONE
  ======================================================= */

  const phone =
    normalizePhone(
      body.phone
    );

  if (!phone) {

    return json(res, 400, {

      success: false,

      error:
        "Informe o número de telefone."

    });
  }


  /*
   * Aceita:
   *
   * 841234567
   * 851234567
   * 861234567
   * 871234567
   *
   * Também:
   *
   * +258841234567
   * 258841234567
   */

  const phoneDigits =
    phone.replace(
      /^\+?258/,
      ""
    );


  if (
    !/^\d{9}$/.test(
      phoneDigits
    )
  ) {

    return json(res, 400, {

      success: false,

      error:
        "Número de telefone inválido."

    });
  }


  /* =======================================================
     MÉTODO DE PAGAMENTO
  ======================================================= */

  const payment =
    normalizePayment(
      body.payment_method ||
      body.payment
    );

  if (!payment) {

    return json(res, 400, {

      success: false,

      error:
        "Escolha M-Pesa ou e-Mola."

    });
  }


  /* =======================================================
     OPERAÇÃO
  ======================================================= */

  const operation =
    String(
      body.operation || "buy"
    )
      .trim()
      .toLowerCase();


  if (
    operation !== "buy"
  ) {

    return json(res, 400, {

      success: false,

      error:
        "Operação inválida."

    });
  }


  /* =======================================================
     VALOR MZN
  ======================================================= */

  const amountInput =
    body.amount_mzn ??
    body.amount ??
    body.amountMzn;


  if (
    amountInput === undefined ||
    amountInput === null ||
    amountInput === ""
  ) {

    return json(res, 400, {

      success: false,

      error:
        "Informe o valor em MZN."

    });
  }


  /* =======================================================
     CONVERTER VALOR
  ======================================================= */

  const amount =
    Number(amountInput);


  /*
   * Aceitamos somente números inteiros.
   *
   * Exemplo:
   *
   * 1000       válido
   * 5000       válido
   * 10000      válido
   *
   * 1000.50    inválido
   */

  if (
    !Number.isSafeInteger(
      amount
    )
  ) {

    return json(res, 400, {

      success: false,

      error:
        "O valor em MZN deve ser um número inteiro."

    });
  }


  /* =======================================================
     LIMITES
  ======================================================= */

  if (
    amount < MIN_AMOUNT_MZN ||
    amount > MAX_AMOUNT_MZN
  ) {

    return json(res, 400, {

      success: false,

      error:
        `O valor deve estar entre ${MIN_AMOUNT_MZN} e ${MAX_AMOUNT_MZN} MZN.`

    });
  }


  /* =======================================================
     CALCULAR USDT
  ======================================================= */

  /*
   * TAXA FIXA:
   *
   * 1 USDT = 50 MZN
   *
   * Portanto:
   *
   * 1000 / 50 = 20
   *
   * 5000 / 50 = 100
   *
   * 20000 / 50 = 400
   */

  const usdtAmount =
    amount / RATE;


  if (
    !Number.isFinite(
      usdtAmount
    ) ||
    usdtAmount <= 0
  ) {

    return json(res, 400, {

      success: false,

      error:
        "Não foi possível calcular o valor em USDT."

    });
  }


  /* =======================================================
     ID DO PEDIDO
  ======================================================= */

  const orderId =
    generateOrderId();


  /* =======================================================
     GUARDAR NO NEON
  ======================================================= */

  const result =
    await sql`

      INSERT INTO orders (

        order_id,
        name,
        phone,
        operation,
        payment,
        amount,
        usdt_amount,
        rate,
        status

      )

      VALUES (

        ${orderId},
        ${name},
        ${phoneDigits},
        ${operation},
        ${payment},
        ${amount},
        ${usdtAmount},
        ${RATE},
        'PENDING'

      )

      RETURNING

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
        created_at

    `;


  const order =
    result[0];


  /* =======================================================
     FORMATO DA CONVERSÃO
  ======================================================= */

  /*
   * Aqui NÃO usamos:
   *
   * 1000 MZN → 20.000000 USDT
   *
   * Usamos:
   *
   * 1000-20 USDT
   */

  const conversionText =
    `${Number(order.amount)}-${Number(order.usdt_amount)} USDT`;


  /* =======================================================
     RESPOSTA
  ======================================================= */

  return json(res, 201, {

    success: true,

    message:
      "Pedido criado com sucesso.",


    /* -----------------------------------------------------
       CONVERSÃO
    ----------------------------------------------------- */

    conversion:
      conversionText,


    /* -----------------------------------------------------
       PEDIDO
    ----------------------------------------------------- */

    order: {

      id:
        order.id,

      order_id:
        order.order_id,

      name:
        order.name,

      phone:
        order.phone,

      operation:
        order.operation,

      payment:
        order.payment,

      amount_mzn:
        Number(
          order.amount
        ),

      usdt_amount:
        Number(
          order.usdt_amount
        ),

      rate:
        Number(
          order.rate
        ),

      status:
        order.status,

      created_at:
        order.created_at

    }

  });
}


/* =========================================================
   HANDLER PRINCIPAL
========================================================= */

export default async function handler(
  req,
  res
) {


  /* =======================================================
     MÉTODO HTTP
  ======================================================= */

  if (
    req.method !== "POST"
  ) {

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
     DATABASE
  ======================================================= */

  if (
    !process.env.DATABASE_URL
  ) {

    return json(res, 500, {

      success: false,

      error:
        "DATABASE_URL não configurada no Vercel."

    });
  }


  /* =======================================================
     EXECUTAR
  ======================================================= */

  try {

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    return await createOrder(
      req,
      res,
      sql
    );


  } catch (error) {

    console.error(
      "USDTMZ ORDER ERROR:",
      error?.message ||
      error
    );


    return json(res, 500, {

      success: false,

      error:
        "Erro interno ao criar o pedido."

    });
  }
}
