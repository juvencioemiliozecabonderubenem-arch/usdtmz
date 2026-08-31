import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

/*
 * =========================================================
 * USDTMZ — PROCESS WITHDRAWAL
 * ETAPA: SAFE_VALIDATION → TRANSACTION_READY
 * =========================================================
 *
 * Este arquivo:
 *
 * ✓ exige retirada AUTHORIZED
 * ✓ valida destino
 * ✓ valida valor
 * ✓ confirma carteira Mainnet
 * ✓ confirma TRON_PRIVATE_KEY
 * ✓ confirma que a chave corresponde à carteira
 * ✓ consulta TRX
 * ✓ consulta Energy
 * ✓ consulta Bandwidth
 * ✓ consulta saldo USDT real
 * ✓ simula o contrato USDT
 * ✓ cria a transação USDT sem transmiti-la
 * ✓ retorna raw_data / raw_data_hex / txID
 *
 * NÃO FAZ:
 *
 * ✗ não assina
 * ✗ não transmite
 * ✗ não coloca chave privada na resposta
 *
 * Próxima etapa:
 *
 * TRANSACTION_READY
 *       ↓
 * assinatura autorizada
 *       ↓
 * broadcast
 *
 * =========================================================
 */

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";

const ENABLE_TRANSACTION_BUILD =
  String(
    process.env.ENABLE_TRANSACTION_BUILD || "true"
  ).toLowerCase() === "true";


/*
 * =========================================================
 * JSON
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
 * TRON ADDRESS
 * =========================================================
 */

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}


/*
 * =========================================================
 * USDT PARSER
 * =========================================================
 */

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

  const raw =
    BigInt(whole) *
      1_000_000n +
    BigInt(padded);

  if (raw <= 0n) {
    return null;
  }

  return raw;
}


/*
 * =========================================================
 * USDT FORMAT
 * =========================================================
 */

function formatUsdtAmount(raw) {
  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (
      value % 1_000_000n
    )
      .toString()
      .padStart(
        USDT_DECIMALS,
        "0"
      );

  return `${whole}.${decimal}`;
}


/*
 * =========================================================
 * PRIVATE KEY
 * =========================================================
 *
 * A chave nunca é retornada.
 * Ela somente é usada internamente para
 * confirmar a carteira do servidor.
 * =========================================================
 */

function getPrivateKey() {
  const key =
    String(
      process.env.TRON_PRIVATE_KEY || ""
    ).trim();

  if (!key) {
    throw new Error(
      "TRON_PRIVATE_KEY não configurada."
    );
  }

  const normalized =
    key.startsWith("0x")
      ? key.slice(2)
      : key;

  if (
    !/^[0-9a-fA-F]{64}$/.test(
      normalized
    )
  ) {
    throw new Error(
      "TRON_PRIVATE_KEY inválida."
    );
  }

  return normalized;
}


/*
 * =========================================================
 * TRONWEB
 * =========================================================
 */

function createTronWeb() {
  return new TronWeb({
    fullHost: TRON_HOST,
    privateKey: getPrivateKey()
  });
}


/*
 * =========================================================
 * ENDEREÇO DERIVADO DA CHAVE
 * =========================================================
 */

function getServerAddress(tronWeb) {
  const address =
    tronWeb.address.fromPrivateKey(
      getPrivateKey()
    );

  if (
    !isValidTronAddress(address)
  ) {
    throw new Error(
      "A chave privada não produziu um endereço TRON válido."
    );
  }

  return address;
}


/*
 * =========================================================
 * RESOURCES
 * =========================================================
 */

async function getAccountResources(
  tronWeb,
  address
) {
  const resources =
    await tronWeb.trx.getAccountResources(
      address
    );

  const energyLimit =
    Number(
      resources?.EnergyLimit || 0
    );

  const energyUsed =
    Number(
      resources?.EnergyUsed || 0
    );

  const energyRemaining =
    Math.max(
      0,
      energyLimit -
      energyUsed
    );

  const bandwidthLimit =
    Number(
      resources?.NetLimit || 0
    );

  const bandwidthUsed =
    Number(
      resources?.NetUsed || 0
    );

  const bandwidthRemaining =
    Math.max(
      0,
      bandwidthLimit -
      bandwidthUsed
    );

  return {
    energy_limit:
      energyLimit,

    energy_used:
      energyUsed,

    energy_remaining:
      energyRemaining,

    bandwidth_limit:
      bandwidthLimit,

    bandwidth_used:
      bandwidthUsed,

    bandwidth_remaining:
      bandwidthRemaining
  };
}


/*
 * =========================================================
 * SIMULAÇÃO USDT
 * =========================================================
 *
 * Não transmite.
 * =========================================================
 */

async function simulateUsdtTransfer(
  tronWeb,
  ownerAddress,
  destination,
  rawAmount
) {
  const ownerHex =
    tronWeb.address.toHex(
      ownerAddress
    );

  const contractHex =
    tronWeb.address.toHex(
      USDT_CONTRACT
    );

  const destinationHex =
    tronWeb.address.toHex(
      destination
    );

  const destinationParameter =
    destinationHex
      .replace(/^41/, "")
      .padStart(64, "0");

  const amountParameter =
    BigInt(rawAmount)
      .toString(16)
      .padStart(64, "0");

  const parameter =
    destinationParameter +
    amountParameter;

  const response =
    await fetch(
      `${TRON_HOST}/wallet/triggerconstantcontract`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "TRON-PRO-API-KEY":
            process.env.TRONGRID_API_KEY
        },

        body:
          JSON.stringify({
            owner_address:
              ownerHex,

            contract_address:
              contractHex,

            function_selector:
              "transfer(address,uint256)",

            parameter,

            call_value:
              0,

            visible:
              false
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `TRONGrid simulation HTTP ${response.status}`
    );
  }

  return data;
}


/*
 * =========================================================
 * CRIAR TRANSAÇÃO USDT
 * =========================================================
 *
 * IMPORTANTE:
 *
 * transactionBuilder.triggerSmartContract()
 * apenas constrói a transação.
 *
 * Não fazemos:
 *
 * tronWeb.trx.sign()
 *
 * nem:
 *
 * tronWeb.trx.sendRawTransaction()
 *
 * nesta etapa.
 * =========================================================
 */

async function buildUsdtTransaction(
  tronWeb,
  ownerAddress,
  destination,
  rawAmount
) {
  const functionSelector =
    "transfer(address,uint256)";

  const parameter = [
    {
      type: "address",
      value: destination
    },
    {
      type: "uint256",
      value: rawAmount.toString()
    }
  ];

  const result =
    await tronWeb.transactionBuilder
      .triggerSmartContract(
        USDT_CONTRACT,
        functionSelector,
        {
          feeLimit:
            100_000_000
        },
        parameter,
        ownerAddress
      );

  if (
    !result ||
    !result.transaction
  ) {
    throw new Error(
      "TRON não retornou uma transação válida."
    );
  }

  return result.transaction;
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
     * =====================================================
     * CONFIGURAÇÃO
     * =====================================================
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

    if (
      !process.env.TRONGRID_API_KEY
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRONGRID_API_KEY não configurada."
        }
      );
    }

    if (
      !process.env.TRON_PRIVATE_KEY
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRON_PRIVATE_KEY não configurada."
        }
      );
    }


    /*
     * =====================================================
     * DATABASE
     * =====================================================
     */

    const sql =
      neon(
        process.env.DATABASE_URL
      );


    const body =
      req.body || {};

    const withdrawalId =
      String(
        body.withdrawal_id || ""
      ).trim();


    if (!withdrawalId) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "withdrawal_id é obrigatório."
        }
      );
    }


    /*
     * =====================================================
     * RETIRADA
     * =====================================================
     */

    const withdrawals =
      await sql`
        SELECT
          id,
          withdrawal_id,
          destination_address,
          asset,
          network,
          amount,
          amount_requested,
          withdrawal_fee,
          amount_to_send,
          status,
          tx_hash,
          created_at,
          updated_at,
          order_id
        FROM withdrawals
        WHERE withdrawal_id =
          ${withdrawalId}
        LIMIT 1
      `;


    if (
      withdrawals.length === 0
    ) {
      return json(
        res,
        404,
        {
          success: false,
          error:
            "Retirada não encontrada."
        }
      );
    }


    const withdrawal =
      withdrawals[0];


    const status =
      String(
        withdrawal.status || ""
      ).toUpperCase();


    /*
     * =====================================================
     * ESTADOS FINAIS
     * =====================================================
     */

    if (
      status === "COMPLETED"
    ) {
      return json(
        res,
        200,
        {
          success: true,
          already_completed:
            true,

          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status,

            tx_hash:
              withdrawal.tx_hash
          }
        }
      );
    }


    if (
      withdrawal.tx_hash
    ) {
      return json(
        res,
        409,
        {
          success: false,
          error:
            "Esta retirada já possui TX hash."
        }
      );
    }


    /*
     * =====================================================
     * AUTHORIZATION
     * =====================================================
     */

    if (
      status !== "AUTHORIZED"
    ) {
      return json(
        res,
        409,
        {
          success: false,

          error:
            "A retirada precisa estar AUTHORIZED antes da preparação.",

          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,

            status:
              withdrawal.status
          }
        }
      );
    }


    /*
     * =====================================================
     * ASSET
     * =====================================================
     */

    if (
      String(
        withdrawal.asset || ""
      ).toUpperCase() !==
      ASSET
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Asset inválido. Esperado USDT."
        }
      );
    }


    /*
     * =====================================================
     * NETWORK
     * =====================================================
     */

    if (
      String(
        withdrawal.network || ""
      ) !==
      NETWORK
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "A retirada não está em TRON Mainnet."
        }
      );
    }


    /*
     * =====================================================
     * DESTINO
     * =====================================================
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
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Endereço TRON de destino inválido."
        }
      );
    }


    /*
     * =====================================================
     * VALOR
     * =====================================================
     */

    const rawAmount =
      parseUsdtAmount(
        withdrawal.amount_to_send ??
        withdrawal.amount
      );


    if (
      rawAmount === null
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Valor USDT inválido."
        }
      );
    }


    const amountToSend =
      formatUsdtAmount(
        rawAmount
      );


    /*
     * =====================================================
     * CARTEIRA DO SISTEMA
     * =====================================================
     */

    const wallets =
      await sql`
        SELECT
          id,
          wallet_address,
          network,
          asset,
          balance,
          status
        FROM wallets
        WHERE network =
          ${NETWORK}
          AND asset =
          ${ASSET}
          AND status =
          'mainnet'
        ORDER BY id DESC
        LIMIT 1
      `;


    if (
      wallets.length === 0
    ) {
      return json(
        res,
        404,
        {
          success: false,
          error:
            "Carteira USDT Mainnet não encontrada."
        }
      );
    }


    const wallet =
      wallets[0];


    const walletAddress =
      String(
        wallet.wallet_address ||
        ""
      ).trim();


    if (
      !isValidTronAddress(
        walletAddress
      )
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "Carteira TRON configurada inválida."
        }
      );
    }


    /*
     * =====================================================
     * TRONWEB
     * =====================================================
     */

    const tronWeb =
      createTronWeb();


    /*
     * =====================================================
     * CONFIRMAR CHAVE
     * =====================================================
     */

    const serverAddress =
      getServerAddress(
        tronWeb
      );


    if (
      serverAddress !==
      walletAddress
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "A TRON_PRIVATE_KEY não corresponde à carteira USDTMZ."
        }
      );
    }


    /*
     * =====================================================
     * TRX
     * =====================================================
     */

    const trxSun =
      await tronWeb.trx.getBalance(
        walletAddress
      );


    const trxBalance =
      Number(trxSun) /
      1_000_000;


    if (
      !Number.isFinite(
        trxBalance
      )
    ) {
      return json(
        res,
        502,
        {
          success: false,
          error:
            "Não foi possível consultar TRX."
        }
      );
    }


    /*
     * =====================================================
     * RESOURCES
     * =====================================================
     */

    const resources =
      await getAccountResources(
        tronWeb,
        walletAddress
      );


    /*
     * =====================================================
     * CONTRATO USDT
     * =====================================================
     */

    const contract =
      await tronWeb
        .contract()
        .at(
          USDT_CONTRACT
        );


    /*
     * =====================================================
     * SALDO USDT REAL
     * =====================================================
     */

    const blockchainRawBalance =
      await contract
        .balanceOf(
          walletAddress
        )
        .call();


    const blockchainBalance =
      BigInt(
        String(
          blockchainRawBalance
        )
      );


    if (
      blockchainBalance <
      rawAmount
    ) {
      return json(
        res,
        400,
        {
          success: false,

          error:
            "Saldo USDT real insuficiente na carteira.",

          blockchain_balance:
            formatUsdtAmount(
              blockchainBalance
            ),

          requested:
            amountToSend
        }
      );
    }


    /*
     * =====================================================
     * SIMULAÇÃO
     * =====================================================
     */

    let simulation;


    try {

      simulation =
        await simulateUsdtTransfer(
          tronWeb,
          walletAddress,
          destination,
          rawAmount
        );

    } catch (error) {

      console.error(
        "USDTMZ SIMULATION ERROR:",
        error?.message ||
        error
      );

      return json(
        res,
        502,
        {
          success: false,
          error:
            "Não foi possível simular a transferência USDT."
        }
      );
    }


    /*
     * =====================================================
     * RESULTADO DA SIMULAÇÃO
     * =====================================================
     */

    const simulationFailed =
      simulation?.result?.result ===
      false;


    if (
      simulationFailed
    ) {
      return json(
        res,
        400,
        {
          success: false,

          error:
            "A simulação TRC-20 falhou.",

          simulation
        }
      );
    }


    const energyEstimated =
      Number(
        simulation?.energy_used ||
        simulation?.energy_required ||
        0
      );


    const energyShortfall =
      Math.max(
        0,
        energyEstimated -
        resources.energy_remaining
      );


    /*
     * =====================================================
     * TRANSACTION READY
     * =====================================================
     */

    if (
      !ENABLE_TRANSACTION_BUILD
    ) {
      return json(
        res,
        200,
        {
          success: true,

          mode:
            "SAFE_VALIDATION",

          broadcasted:
            false,

          message:
            "SAFE_VALIDATION concluída. A construção da transação está desligada.",

          withdrawal_id:
            withdrawal.withdrawal_id
        }
      );
    }


    let transaction;


    try {

      transaction =
        await buildUsdtTransaction(
          tronWeb,
          walletAddress,
          destination,
          rawAmount
        );

    } catch (error) {

      console.error(
        "USDTMZ BUILD TRANSACTION ERROR:",
        error?.message ||
        error
      );

      return json(
        res,
        502,
        {
          success: false,

          error:
            "Não foi possível construir a transação TRC-20.",

          details:
            error?.message ||
            String(error)
        }
      );
    }


    /*
     * =====================================================
     * RESPOSTA FINAL
     * =====================================================
     *
     * NÃO há assinatura.
     * NÃO há broadcast.
     * NÃO há chave privada.
     * =====================================================
     */

    return json(
      res,
      200,
      {

        success:
          true,

        mode:
          "TRANSACTION_READY",

        broadcasted:
          false,

        withdrawal_id:
          withdrawal.withdrawal_id,

        sender:
          walletAddress,

        destination:
          destination,

        asset:
          ASSET,

        network:
          NETWORK,

        standard:
          "TRC-20",

        contract:
          USDT_CONTRACT,

        amount_requested:
          withdrawal.amount_requested,

        withdrawal_fee:
          withdrawal.withdrawal_fee,

        amount_to_send:
          amountToSend,

        transaction: {

          txID:
            transaction.txID,

          raw_data:
            transaction.raw_data,

          raw_data_hex:
            transaction.raw_data_hex,

          visible:
            false
        },

        resources: {

          trx_balance:
            trxBalance,

          energy_available:
            resources.energy_remaining,

          energy_estimated:
            energyEstimated,

          energy_shortfall:
            energyShortfall,

          bandwidth_available:
            resources.bandwidth_remaining

        },

        validation: {

          authorized:
            true,

          wallet_matches_private_key:
            true,

          usdt_balance_ok:
            true,

          trx_checked:
            true,

          energy_checked:
            true,

          bandwidth_checked:
            true,

          simulation_ok:
            true

        },

        signature: {

          required:
            true,

          performed:
            false,

          private_key_included:
            false

        }

      }
    );

  } catch (error) {

    console.error(
      "USDTMZ PROCESS WITHDRAWAL ERROR:",
      error?.message ||
      error
    );

    return json(
      res,
      500,
      {
        success: false,

        error:
          "Erro interno ao preparar a retirada.",

        details:
          error?.message ||
          String(error)
      }
    );
  }
}
