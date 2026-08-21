import { neon } from "@neondatabase/serverless";
import { TronWeb } from "tronweb";

const TRON_HOST = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;
const MAX_WITHDRAWAL_USDT = 1_000_000;
const FEE_LIMIT = 100_000_000; // 100 TRX

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function parseUsdtAmount(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] = text.split(".");

  return (
    BigInt(whole) * 1_000_000n +
    BigInt(decimal.padEnd(6, "0"))
  );
}

function formatUsdtAmount(raw) {
  const value = BigInt(raw);

  const whole = value / 1_000_000n;

  const decimal = String(value % 1_000_000n)
    .padStart(6, "0");

  return `${whole}.${decimal}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  let withdrawalId = "";

  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    if (!process.env.TRON_PRIVATE_KEY) {
      return res.status(503).json({
        success: false,
        error: "TRON_PRIVATE_KEY não configurada."
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    withdrawalId =
      String(req.body?.withdrawal_id || "").trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Informe withdrawal_id."
      });
    }

    /*
     * =========================
     * BUSCAR RETIRADA
     * =========================
     */

    const rows = await sql`
      SELECT
        id,
        withdrawal_id,
        order_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash
      FROM withdrawals
      WHERE withdrawal_id = ${withdrawalId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Retirada não encontrada."
      });
    }

    const withdrawal = rows[0];

    /*
     * =========================
     * IMPEDIR DUPLICAÇÃO
     * =========================
     */

    if (
      withdrawal.status === "SENT" ||
      withdrawal.status === "CONFIRMED"
    ) {
      return res.status(409).json({
        success: false,
        error: "Esta retirada já foi processada.",
        withdrawal
      });
    }

    /*
     * =========================
     * EXIGIR AUTORIZAÇÃO
     * =========================
     */

    if (withdrawal.status !== "AUTHORIZED") {
      return res.status(409).json({
        success: false,
        error:
          "A retirada precisa estar AUTHORIZED antes do envio."
      });
    }

    /*
     * =========================
     * VALIDAR ATIVO
     * =========================
     */

    if (
      String(withdrawal.asset).toUpperCase() !== "USDT"
    ) {
      return res.status(400).json({
        success: false,
        error: "O ativo precisa ser USDT."
      });
    }

    /*
     * =========================
     * VALIDAR REDE
     * =========================
     */

    if (
      String(withdrawal.network).toLowerCase() !==
      "tron mainnet"
    ) {
      return res.status(400).json({
        success: false,
        error: "A rede precisa ser TRON Mainnet."
      });
    }

    /*
     * =========================
     * DESTINO
     * =========================
     */

    const destination =
      String(
        withdrawal.destination_address || ""
      ).trim();

    if (!isValidTronAddress(destination)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    /*
     * =========================
     * VALOR
     * =========================
     */

    const rawAmount =
      parseUsdtAmount(withdrawal.amount);

    if (rawAmount === null || rawAmount <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Valor USDT inválido."
      });
    }

    if (
      rawAmount >
      BigInt(MAX_WITHDRAWAL_USDT) * 1_000_000n
    ) {
      return res.status(400).json({
        success: false,
        error: "Valor acima do limite permitido."
      });
    }

    /*
     * =========================
     * TRONWEB
     * =========================
     */

    const tronWeb = new TronWeb({
      fullHost: TRON_HOST,
      privateKey:
        String(process.env.TRON_PRIVATE_KEY).trim()
    });

    const sender =
      tronWeb.defaultAddress.base58;

    if (!isValidTronAddress(sender)) {
      return res.status(500).json({
        success: false,
        error: "A chave privada não gerou uma carteira TRON válida."
      });
    }

    /*
     * =========================
     * CONFIRMAR CARTEIRA
     * =========================
     */

    const wallets = await sql`
      SELECT wallet_address
      FROM wallets
      WHERE network = 'TRON Mainnet'
        AND asset = 'USDT'
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;

    if (wallets.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Carteira TRON Mainnet não encontrada."
      });
    }

    const configuredWallet =
      String(wallets[0].wallet_address || "").trim();

    if (
      configuredWallet.toLowerCase() !==
      sender.toLowerCase()
    ) {
      return res.status(409).json({
        success: false,
        error:
          "A TRON_PRIVATE_KEY não corresponde à carteira configurada."
      });
    }

    /*
     * =========================
     * CONTRATO USDT
     * =========================
     */

    const contract =
      await tronWeb.contract().at(
        USDT_CONTRACT
      );

    const balanceRaw =
      await contract
        .balanceOf(sender)
        .call();

    const balance =
      BigInt(String(balanceRaw));

    if (balance < rawAmount) {
      return res.status(400).json({
        success: false,
        error: "Saldo USDT insuficiente.",
        balance: formatUsdtAmount(balance),
        requested: formatUsdtAmount(rawAmount)
      });
    }

    /*
     * =========================
     * RESERVAR RETIRADA
     * AUTHORIZED → PROCESSING
     * =========================
     */

    const processing = await sql`
      UPDATE withdrawals
      SET
        status = 'PROCESSING',
        updated_at = NOW()
      WHERE withdrawal_id = ${withdrawalId}
        AND status = 'AUTHORIZED'
      RETURNING *
    `;

    if (processing.length === 0) {
      return res.status(409).json({
        success: false,
        error:
          "A retirada já está sendo processada."
      });
    }

    /*
     * =========================
     * CONSTRUIR TRANSFERÊNCIA
     * =========================
     */

    const transaction =
      await tronWeb.transactionBuilder.triggerSmartContract(
        USDT_CONTRACT,
        "transfer(address,uint256)",
        {
          feeLimit: FEE_LIMIT,
          callValue: 0
        },
        [
          {
            type: "address",
            value: destination
          },
          {
            type: "uint256",
            value: rawAmount.toString()
          }
        ],
        sender
      );

    if (
      !transaction ||
      !transaction.transaction
    ) {
      throw new Error(
        "Não foi possível construir a transação."
      );
    }

    /*
     * =========================
     * ASSINAR
     * =========================
     */

    const signed =
      await tronWeb.trx.sign(
        transaction.transaction,
        process.env.TRON_PRIVATE_KEY
      );

    if (!signed) {
      throw new Error(
        "Não foi possível assinar a transação."
      );
    }

    /*
     * =========================
     * ENVIAR PARA TRON MAINNET
     * =========================
     */

    const broadcast =
      await tronWeb.trx.sendRawTransaction(
        signed
      );

    if (
      !broadcast ||
      broadcast.result !== true
    ) {
      console.error(
        "TRON BROADCAST:",
        broadcast
      );

      await sql`
        UPDATE withdrawals
        SET
          status = 'FAILED',
          updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
          AND status = 'PROCESSING'
      `;

      return res.status(502).json({
        success: false,
        error: "A TRON Mainnet recusou a transação."
      });
    }

    /*
     * =========================
     * TX HASH
     * =========================
     */

    const txHash =
      broadcast.txid ||
      signed.txID;

    if (!txHash) {
      throw new Error(
        "Transação enviada sem TXID."
      );
    }

    /*
     * =========================
     * GUARDAR RESULTADO
     * =========================
     */

    const updated =
      await sql`
        UPDATE withdrawals
        SET
          status = 'SENT',
          tx_hash = ${txHash},
          updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
        RETURNING
          withdrawal_id,
          destination_address,
          amount,
          status,
          tx_hash,
          updated_at
      `;

    /*
     * =========================
     * ATUALIZAR ORDER
     * =========================
     */

    if (withdrawal.order_id) {
      await sql`
        UPDATE orders
        SET
          blockchain_tx_hash = ${txHash},
          wallet_address = ${destination},
          updated_at = NOW()
        WHERE order_id = ${withdrawal.order_id}
      `;
    }

    return res.status(200).json({
      success: true,
      message:
        "Retirada enviada para a TRON Mainnet.",
      withdrawal: updated[0],
      transaction: {
        tx_hash: txHash,
        from: sender,
        to: destination,
        asset: "USDT",
        network: "TRON Mainnet",
        contract: USDT_CONTRACT,
        amount: formatUsdtAmount(rawAmount)
      }
    });

  } catch (error) {

    console.error(
      "PROCESS WITHDRAWAL ERROR:",
      error
    );

    if (process.env.DATABASE_URL && withdrawalId) {
      try {
        const sql =
          neon(process.env.DATABASE_URL);

        await sql`
          UPDATE withdrawals
          SET
            status = 'FAILED',
            updated_at = NOW()
          WHERE withdrawal_id = ${withdrawalId}
            AND status = 'PROCESSING'
        `;
      } catch (dbError) {
        console.error(
          "STATUS UPDATE ERROR:",
          dbError
        );
      }
    }

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível processar a retirada."
    });
  }
}
