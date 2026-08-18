import { neon } from "@neondatabase/serverless";

const USDT_DECIMALS = 6;

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function isValidUsdtAmount(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return false;
  }

  return Number.isInteger(
    number * 10 ** USDT_DECIMALS
  );
}

function generateWithdrawalId() {
  const random =
    Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();

  return `USDTMZ-WD-${random}`;
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    const {
      order_id,
      payment_transaction_id,
      destination_address
    } = req.body || {};

    const orderId =
      String(order_id || "").trim();

    const paymentTransactionId =
      String(
        payment_transaction_id || ""
      ).trim();

    const destination =
      String(
        destination_address || ""
      ).trim();


    /*
     * =========================
     * VALIDAR DADOS
     * =========================
     */

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "Informe o order_id."
      });
    }

    if (!paymentTransactionId) {
      return res.status(400).json({
        success: false,
        error:
          "Informe o ID da transação do pagamento."
      });
    }

    if (!destination) {
      return res.status(400).json({
        success: false,
        error:
          "Informe o endereço TRON de destino."
      });
    }

    if (!isValidTronAddress(destination)) {
      return res.status(400).json({
        success: false,
        error:
          "Endereço TRON inválido."
      });
    }


    const sql =
      neon(process.env.DATABASE_URL);


    /*
     * =========================
     * BUSCAR PEDIDO
     * =========================
     */

    const orders = await sql`
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
        mpesa_transaction_id,
        blockchain_tx_hash,
        wallet_address,
        created_at,
        updated_at
      FROM orders
      WHERE order_id = ${orderId}
      LIMIT 1
    `;

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Pedido não encontrado."
      });
    }

    const order = orders[0];


    /*
     * =========================
     * IMPEDIR DUPLICAÇÃO
     * =========================
     */

    if (
      order.status === "PAID" ||
      order.status === "PROCESSING" ||
      order.status === "COMPLETED"
    ) {

      return res.status(409).json({
        success: false,
        error:
          "Este pedido já foi processado.",
        order
      });

    }


    /*
     * =========================
     * VALIDAR OPERAÇÃO
     * =========================
     */

    if (order.operation !== "buy") {

      return res.status(400).json({
        success: false,
        error:
          "Somente pedidos de compra podem gerar envio automático de USDT."
      });

    }


    /*
     * =========================
     * VALIDAR USDT
     * =========================
     */

    if (
      !isValidUsdtAmount(
        order.usdt_amount
      )
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Quantidade de USDT do pedido inválida."
      });

    }


    /*
     * =========================
     * VERIFICAR TRANSAÇÃO
     * =========================
     *
     * Evita reutilizar o mesmo ID
     * de pagamento em outro pedido.
     */

    const existingPayment =
      await sql`
        SELECT
          order_id,
          status
        FROM orders
        WHERE mpesa_transaction_id =
          ${paymentTransactionId}
        LIMIT 1
      `;

    if (
      existingPayment.length > 0 &&
      existingPayment[0].order_id !== orderId
    ) {

      return res.status(409).json({
        success: false,
        error:
          "Esta transação de pagamento já está associada a outro pedido."
      });

    }


    /*
     * =========================
     * CRIAR WITHDRAWAL
     * =========================
     */

    const withdrawalId =
      generateWithdrawalId();


    /*
     * Atualização do pedido
     */

    const updatedOrders =
      await sql`
        UPDATE orders
        SET
          status = 'PAID',
          mpesa_transaction_id =
            ${paymentTransactionId},
          wallet_address =
            ${destination},
          updated_at = NOW()
        WHERE order_id = ${orderId}
          AND status = 'PENDING'
        RETURNING
          order_id,
          status,
          usdt_amount,
          wallet_address,
          updated_at
      `;

    if (updatedOrders.length === 0) {

      return res.status(409).json({
        success: false,
        error:
          "O pedido não está mais disponível para confirmação."
      });

    }


    /*
     * Criar levantamento
     */

    const withdrawals =
      await sql`
        INSERT INTO withdrawals (
          withdrawal_id,
          order_id,
          destination_address,
          asset,
          network,
          amount,
          status
        )
        VALUES (
          ${withdrawalId},
          ${orderId},
          ${destination},
          'USDT',
          'TRON Mainnet',
          ${order.usdt_amount},
          'PENDING'
        )
        RETURNING
          withdrawal_id,
          order_id,
          destination_address,
          asset,
          network,
          amount,
          status,
          created_at
      `;


    /*
     * =========================
     * RESPOSTA
     * =========================
     */

    return res.status(201).json({

      success: true,

      message:
        "Pagamento confirmado e withdrawal criado.",

      order:
        updatedOrders[0],

      withdrawal:
        withdrawals[0]

    });

  } catch (error) {

    console.error(
      "USDTMZ CONFIRM PAYMENT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível confirmar o pagamento."
    });

  }

}
