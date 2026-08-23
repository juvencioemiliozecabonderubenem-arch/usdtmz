import { neon } from "@neondatabase/serverless";
import { TronWeb } from "tronweb";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const TRON_FULL_NODE =
  "https://api.trongrid.io";

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

function parseUsdtAmount(value) {
  const text =
    String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] =
    text.split(".");

  const padded =
    decimal.padEnd(
      USDT_DECIMALS,
      "0"
    );

  return (
    BigInt(whole) * 1_000_000n +
    BigInt(padded)
  );
}

function getTransactionContract(tx) {
  const contracts =
    tx?.raw_data?.contract;

  if (!Array.isArray(contracts)) {
    return null;
  }

  for (const item of contracts) {
    if (
      item?.type ===
      "TriggerSmartContract"
    ) {
      return item;
    }
  }

  return null;
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
        error:
          "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(
        process.env.DATABASE_URL
      );

    const {
      withdrawal_id,
      signed_transaction
    } = req.body || {};

    const withdrawalId =
      String(
        withdrawal_id || ""
      ).trim();

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error:
          "Informe o withdrawal_id."
      });
    }

    if (
      !signed_transaction ||
      typeof signed_transaction !==
        "object"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Transação assinada não informada."
      });
    }

    /*
     * =========================
     * BUSCAR WITHDRAWAL
     * =========================
     */

    const result =
      await sql`
        SELECT
          id,
          withdrawal_id,
          destination_address,
          asset,
          network,
          amount,
          status,
          tx_hash
        FROM withdrawals
        WHERE withdrawal_id =
          ${withdrawalId}
        LIMIT 1
      `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error:
          "Retirada não encontrada."
      });
    }

    const withdrawal =
      result[0];


    /*
     * =========================
     * STATUS
     * =========================
     */

    if (
      withdrawal.status !==
      "READY_FOR_SECURE_SIGNING"
    ) {
      return res.status(409).json({
        success: false,
        error:
          `Estado inválido: ${withdrawal.status}. A retirada precisa estar READY_FOR_SECURE_SIGNING.`
      });
    }


    /*
     * =========================
     * ASSET
     * =========================
     */

    if (
      String(
        withdrawal.asset
      ).toUpperCase() !==
      "USDT"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "O ativo não é USDT."
      });
    }


    /*
     * =========================
     * NETWORK
     * =========================
     */

    if (
      String(
        withdrawal.network
      ).toLowerCase() !==
      "tron mainnet"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "A rede não é TRON Mainnet."
      });
    }


    /*
     * =========================
     * DESTINO
     * =========================
     */

    const destination =
      String(
        withdrawal.destination_address ||
        ""
      ).trim();

    if (
      !isValidTronAddress(
        destination
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Endereço TRON de destino inválido."
      });
    }


    /*
     * =========================
     * VALOR ESPERADO
     * =========================
     */

    const expectedAmount =
      parseUsdtAmount(
        withdrawal.amount
      );

    if (
      expectedAmount === null ||
      expectedAmount <= 0n
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Valor USDT armazenado inválido."
      });
    }


    /*
     * =========================
     * VALIDAR ESTRUTURA TRON
     * =========================
     */

    const tx =
      signed_transaction;

    if (
      !tx.txID ||
      typeof tx.txID !==
        "string"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "TXID da transação assinada ausente."
      });
    }

    if (
      !tx.raw_data
    ) {
      return res.status(400).json({
        success: false,
        error:
          "raw_data ausente."
      });
    }

    if (
      !Array.isArray(
        tx.raw_data.contract
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Contrato da transação ausente."
      });
    }


    /*
     * =========================
     * TRONWEB
     * =========================
     */

    const tronWeb =
      new TronWeb({
        fullHost:
          TRON_FULL_NODE
      });


    /*
     * =========================
     * ENCONTRAR SMART CONTRACT
     * =========================
     */

    const contract =
      getTransactionContract(
        tx
      );

    if (!contract) {
      return res.status(400).json({
        success: false,
        error:
          "A transação não contém TriggerSmartContract."
      });
    }


    /*
     * =========================
     * CONTRATO USDT
     * =========================
     */

    const expectedContractHex =
      tronWeb.address.toHex(
        USDT_CONTRACT
      );

    const actualContractHex =
      contract.parameter?.value
        ?.contract_address;

    if (
      !actualContractHex ||
      actualContractHex.toLowerCase() !==
        expectedContractHex.toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "O contrato da transação não corresponde ao USDT TRC-20 oficial."
      });
    }


    /*
     * =========================
     * DECODIFICAR TRANSFER
     * =========================
     */

    const parameter =
      contract.parameter?.value;

    if (!parameter) {
      return res.status(400).json({
        success: false,
        error:
          "Parâmetros do contrato ausentes."
      });
    }

    const data =
      String(
        parameter.data || ""
      );

    /*
     * transfer(address,uint256)
     *
     * selector:
     * a9059cbb
     */

    if (
      !data
        .toLowerCase()
        .startsWith(
          "a9059cbb"
        )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "A transação não é uma transferência USDT TRC-20."
      });
    }


    /*
     * =========================
     * DECODIFICAR DESTINO
     * =========================
     */

    const destinationHex =
      "41" +
      data.slice(
        8 + 24,
        8 + 64
      );

    let transactionDestination;

    try {

      transactionDestination =
        tronWeb.address.fromHex(
          destinationHex
        );

    } catch {
      return res.status(400).json({
        success: false,
        error:
          "Não foi possível decodificar o destino da transação."
      });
    }


    if (
      transactionDestination
        .toLowerCase() !==
      destination.toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "O destino da transação não corresponde ao withdrawal."
      });
    }


    /*
     * =========================
     * DECODIFICAR VALOR
     * =========================
     */

    const amountHex =
      data.slice(
        8 + 64,
        8 + 128
      );

    if (
      !/^[0-9a-fA-F]{64}$/.test(
        amountHex
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Valor USDT da transação inválido."
      });
    }

    const transactionAmount =
      BigInt(
        "0x" + amountHex
      );


    /*
     * =========================
     * COMPARAR VALOR
     * =========================
     */

    if (
      transactionAmount !==
      expectedAmount
    ) {
      return res.status(400).json({
        success: false,
        error:
          "O valor da transação não corresponde ao valor autorizado."
      });
    }


    /*
     * =========================
     * VERIFICAR ASSINATURA
     * =========================
     *
     * Aqui NÃO transmitimos.
     */

    if (
      !Array.isArray(
        tx.signature
      ) ||
      tx.signature.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "A transação não possui assinatura."
      });
    }


    /*
     * =========================
     * NÃO TRANSMITIR
     * =========================
     */

    return res.status(200).json({

      success: true,

      status:
        "VALIDATED_NOT_BROADCAST",

      message:
        "Transação assinada validada. Nenhuma transmissão foi realizada.",

      withdrawal_id:
        withdrawalId,

      network:
        "TRON Mainnet",

      asset:
        "USDT TRC-20",

      contract:
        USDT_CONTRACT,

      destination:
        destination,

      amount:
        String(
          withdrawal.amount
        ),

      amount_base_units:
        expectedAmount.toString(),

      txid:
        tx.txID,

      signed:
        true,

      broadcasted:
        false

    });

  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL VALIDATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível validar a transação assinada."
    });
  }
}
