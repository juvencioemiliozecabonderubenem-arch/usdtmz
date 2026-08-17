import { neon } from "@neondatabase/serverless";
import { TronWeb } from "tronweb";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const TRON_FULL_NODE =
  process.env.TRON_FULL_NODE ||
  "https://api.trongrid.io";

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function amountToSun(amount) {
  const value = String(amount);

  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("Valor USDT inválido.");
  }

  const parts = value.split(".");
  const integerPart = parts[0];
  const decimalPart =
    (parts[1] || "").padEnd(USDT_DECIMALS, "0");

  return (
    BigInt(integerPart) *
      1000000n +
    BigInt(decimalPart)
  );
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

    const sql = neon(process.env.DATABASE_URL);

    const {
      withdrawal_id
    } = req.body || {};

    const withdrawalId =
      String(withdrawal_id || "").trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Informe o withdrawal_id."
      });
    }

    const result = await sql`
      SELECT
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status
      FROM withdrawals
      WHERE withdrawal_id = ${withdrawalId}
      LIMIT 1
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Retirada não encontrada."
      });
    }

    const withdrawal = result[0];

    if (withdrawal.status !== "AUTHORIZED") {
      return res.status(409).json({
        success: false,
        error:
          "A retirada precisa estar AUTHORIZED."
      });
    }

    if (withdrawal.asset !== "USDT") {
      return res.status(400).json({
        success: false,
        error: "Ativo inválido."
      });
    }

    if (withdrawal.network !== "TRON Mainnet") {
      return res.status(400).json({
        success: false,
        error: "Rede inválida."
      });
    }

    const destination =
      String(
        withdrawal.destination_address || ""
      ).trim();

    if (!isValidTronAddress(destination)) {
      return res.status(400).json({
        success: false,
        error:
          "Endereço TRON de destino inválido."
      });
    }

    const amountString =
      String(withdrawal.amount);

    const amountSun =
      amountToSun(amountString);

    if (amountSun <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Valor USDT inválido."
      });
    }

    /*
     * O endereço operacional NÃO vem da requisição.
     * Ele deve ser configurado posteriormente como
     * variável protegida do ambiente do assinador.
     *
     * Não colocamos chave privada aqui.
     */
    const senderAddress =
      String(
        process.env.TRON_OPERATIONAL_ADDRESS || ""
      ).trim();

    if (!senderAddress) {
      return res.status(503).json({
        success: false,
        error:
          "Carteira operacional ainda não configurada para assinatura segura."
      });
    }

    if (!isValidTronAddress(senderAddress)) {
      return res.status(500).json({
        success: false,
        error:
          "TRON_OPERATIONAL_ADDRESS inválido."
      });
    }

    const tronWeb = new TronWeb({
      fullHost: TRON_FULL_NODE
    });

    /*
     * Verifica se o endereço operacional existe
     * na rede antes de construir a transação.
     */
    const senderHex =
      tronWeb.address.toHex(senderAddress);

    const destinationHex =
      tronWeb.address.toHex(destination);

    if (!senderHex || !destinationHex) {
      return res.status(400).json({
        success: false,
        error:
          "Não foi possível converter os endereços TRON."
      });
    }

    /*
     * Constrói a chamada transfer(address,uint256)
     * do contrato USDT TRC-20.
     *
     * A transação ainda NÃO está assinada.
     */
    const functionSelector =
      "transfer(address,uint256)";

    const parameter =
      [
        {
          type: "address",
          value: destination
        },
        {
          type: "uint256",
          value: amountSun.toString()
        }
      ];

    const unsignedTransaction =
      await tronWeb.transactionBuilder.triggerSmartContract(
        USDT_CONTRACT,
        functionSelector,
        {
          feeLimit: 1000000000,
          callValue: 0
        },
        parameter,
        senderAddress
      );

    if (
      !unsignedTransaction ||
      !unsignedTransaction.transaction
    ) {
      throw new Error(
        "A TRON não devolveu uma transação não assinada válida."
      );
    }

    const transaction =
      unsignedTransaction.transaction;

    /*
     * Atualiza o estado somente depois que a transação
     * não assinada foi construída corretamente.
     */
    const updated = await sql`
      UPDATE withdrawals
      SET
        status = 'READY_FOR_SECURE_SIGNING',
        updated_at = NOW()
      WHERE withdrawal_id = ${withdrawalId}
        AND status = 'AUTHORIZED'
      RETURNING
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        created_at,
        updated_at
    `;

    if (updated.length === 0) {
      return res.status(409).json({
        success: false,
        error:
          "A retirada mudou de estado antes da preparação."
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Transação USDT TRC-20 criada e pronta para assinatura segura.",
      withdrawal: updated[0],
      transaction: {
        contract:
          USDT_CONTRACT,

        network:
          "TRON Mainnet",

        destination_address:
          destination,

        amount:
          amountString,

        amount_base_units:
          amountSun.toString(),

        decimals:
          USDT_DECIMALS,

        signed:
          false,

        broadcasted:
          false,

        status:
          "READY_FOR_SECURE_SIGNING",

        raw_transaction:
          transaction
      }
    });

  } catch (error) {
    console.error(
      "USDTMZ UNSIGNED TRANSACTION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível construir a transação não assinada."
    });
  }
}
:::
