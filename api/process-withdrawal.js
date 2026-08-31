import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

/*
 * =========================================================
 * USDTMZ — PROCESS WITHDRAWAL
 * =========================================================
 *
 * MODO ATUAL:
 *
 * - validação completa
 * - consulta blockchain
 * - consulta TRX
 * - consulta Energy
 * - consulta Bandwidth
 * - simulação da transferência
 * - NÃO transmite fundos
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

/*
 * Mantemos desligado durante a validação.
 */
const ENABLE_TRON_BROADCAST =
  String(
    process.env.ENABLE_TRON_BROADCAST || ""
  ).toLowerCase() === "true";


function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(status)
    .json(data);
}


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

  const raw =
    BigInt(whole) *
      1_000_000n +
    BigInt(padded);

  if (raw <= 0n) {
    return null;
  }

  return raw;
}


function formatUsdtAmount(raw) {
  const value = BigInt(raw);

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


function createTronWeb() {
  return new TronWeb({
    fullHost: TRON_HOST,
    privateKey: getPrivateKey()
  });
}


function getServerAddress(tronWeb) {
  const address =
    tronWeb.address.fromPrivateKey(
      getPrivateKey()
    );

  if (!isValidTronAddress(address)) {
    throw new Error(
      "A chave privada não corresponde a um endereço TRON válido."
    );
  }

  return address;
}


/*
 * =========================================================
 * CONSULTAR RESOURCES
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
    Number(resources?.EnergyLimit || 0);

  const energyUsed =
    Number(resources?.EnergyUsed || 0);

  const energyRemaining =
    Math.max(
      0,
      energyLimit - energyUsed
    );

  const bandwidthLimit =
    Number(resources?.NetLimit || 0);

  const bandwidthUsed =
    Number(resources?.NetUsed || 0);

  const bandwidthRemaining =
    Math.max(
      0,
      bandwidthLimit - bandwidthUsed
    );

  return {
    energy_limit: energyLimit,
    energy_used: energyUsed,
    energy_remaining: energyRemaining,

    bandwidth_limit: bandwidthLimit,
    bandwidth_used: bandwidthUsed,
    bandwidth_remaining: bandwidthRemaining,

    raw: resources
  };
}


/*
 * =========================================================
 * SIMULAR TRANSFERÊNCIA USDT
 * =========================================================
 *
 * Não transmite.
 * Não altera blockchain.
 *
 * triggerconstantcontract permite prever
 * a execução e retornar energy_used.
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

  /*
   * transfer(address,uint256)
   *
   * address = 32 bytes
   * uint256  = 32 bytes
   */
  const parameter =
    destinationHex
      .replace(/^41/, "")
      .padStart(64, "0") +
    BigInt(rawAmount)
      .toString(16)
      .padStart(64, "0");

  const response =
    await fetch(
      `${TRON_HOST}/wallet/triggerconstantcontract`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          ...(process.env.TRONGRID_API_KEY
            ? {
                "TRON-PRO-API-KEY":
                  process.env.TRONGRID_API_KEY
              }
            : {})
        },

        body: JSON.stringify({
          owner_address:
            ownerHex,

          contract_address:
            contractHex,

          function_selector:
            "transfer(address,uint256)",

          parameter,

          call_value: 0,

          visible: false
        })
      }
    );

  if (!response.ok) {
    throw new Error(
      `Falha na simulação TRON: HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  return data;
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
     * CONFIGURAÇÃO
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

    if (!process.env.TRONGRID_API_KEY) {
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
     * LOCALIZAR RETIRADA
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

    if (withdrawals.length === 0) {
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

    const currentStatus =
      String(
        withdrawal.status || ""
      ).toUpperCase();

    /*
     * JÁ COMPLETADA
     */
    if (
      currentStatus ===
      "COMPLETED"
    ) {
      return json(
        res,
        200,
        {
          success: true,
          already_completed: true,
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

    /*
     * JÁ TEM TX HASH
     */
    if (withdrawal.tx_hash) {
      return json(
        res,
        409,
        {
          success: false,
          error:
            "Esta retirada já possui TX hash.",
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

    /*
     * SOMENTE AUTHORIZED
     */
    if (
      currentStatus !==
      "AUTHORIZED"
    ) {
      return json(
        res,
        409,
        {
          success: false,
          error:
            "A retirada precisa estar AUTHORIZED antes do processamento.",
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
     * ASSET
     */
    if (
      String(
        withdrawal.asset
      ).toUpperCase() !== ASSET
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Asset da retirada não é USDT."
        }
      );
    }

    /*
     * NETWORK
     */
    if (
      String(
        withdrawal.network
      ) !== NETWORK
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "A retirada não está configurada para TRON Mainnet."
        }
      );
    }

    /*
     * DESTINO
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
     * VALOR LÍQUIDO
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
            "Valor USDT da retirada inválido."
        }
      );
    }

    const amountFormatted =
      formatUsdtAmount(
        rawAmount
      );

    /*
     * LOCALIZAR CARTEIRA
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

    if (wallets.length === 0) {
      return json(
        res,
        404,
        {
          success: false,
          error:
            "Carteira USDT TRON Mainnet não encontrada."
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
            "Endereço da carteira USDT inválido."
        }
      );
    }

    /*
     * TRONWEB
     */
    const tronWeb =
      createTronWeb();

    /*
     * CONFIRMAR CHAVE
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
            "A TRON_PRIVATE_KEY não corresponde à carteira configurada no banco."
        }
      );
    }

    /*
     * TRX
     */
    const trxSun =
      await tronWeb.trx.getBalance(
        walletAddress
      );

    const trxBalance =
      Number(trxSun) / 1_000_000;

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
            "Não foi possível consultar o saldo TRX."
        }
      );
    }

    /*
     * RESOURCES
     */
    const resources =
      await getAccountResources(
        tronWeb,
        walletAddress
      );

    /*
     * CONTRATO
     */
    const contract =
      await tronWeb
        .contract()
        .at(
          USDT_CONTRACT
        );

    /*
     * SALDO USDT REAL
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
            "Saldo USDT real insuficiente na carteira TRON.",

          blockchain_balance:
            formatUsdtAmount(
              blockchainBalance
            ),

          requested:
            amountFormatted
        }
      );
    }

    /*
     * SIMULAÇÃO
     */
    let simulation = null;

    try {
      simulation =
        await simulateUsdtTransfer(
          tronWeb,
          walletAddress,
          destination,
          rawAmount
        );
    } catch (simulationError) {
      console.error(
        "USDTMZ TRON SIMULATION ERROR:",
        simulationError?.message ||
        simulationError
      );
    }

    /*
     * ENERGY ESTIMADA
     */
    const energyUsed =
      Number(
        simulation?.energy_used ||
        simulation?.energy_required ||
        0
      );

    const energyAvailable =
      resources.energy_remaining;

    const energyShortfall =
      Math.max(
        0,
        energyUsed -
        energyAvailable
      );

    /*
     * BANDWIDTH
     *
     * A simulação não consome Bandwidth real.
     * Portanto usamos o recurso disponível
     * como informação de validação.
     */
    const bandwidthAvailable =
      resources.bandwidth_remaining;

    /*
     * Não afirmamos que o TRX disponível
     * é suficiente sem conhecer a taxa
     * atual de Energy da rede.
     */
    const resourceCheck = {
      energy_estimated:
        energyUsed,

      energy_available:
        energyAvailable,

      energy_shortfall:
        energyShortfall,

      bandwidth_available:
        bandwidthAvailable,

      trx_balance:
        trxBalance
    };

    /*
     * Se a simulação indicar falha,
     * não continuamos.
     */
    const simulationFailed =
      simulation &&
      simulation.result &&
      simulation.result.result === false;

    if (simulationFailed) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "A simulação da transferência USDT falhou. Nenhum broadcast foi realizado.",

          simulation,
          resources:
            resourceCheck
        }
      );
    }

    /*
     * MODO DE SEGURANÇA
     */
    if (!ENABLE_TRON_BROADCAST) {
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
            "Validação concluída. Nenhuma transação foi transmitida.",

          withdrawal: {
            withdrawal_id:
              withdrawal.withdrawal_id,

            amount_requested:
              withdrawal.amount_requested,

            withdrawal_fee:
              withdrawal.withdrawal_fee,

            amount_to_send:
              amountFormatted,

            destination_address:
              destination,

            asset:
              ASSET,

            network:
              NETWORK,

            status:
              withdrawal.status
          },

          wallet: {
            address:
              walletAddress,

            blockchain_usdt_balance:
              formatUsdtAmount(
                blockchainBalance
              ),

            trx_balance:
              trxBalance
          },

          resources:
            resourceCheck,

          simulation
        }
      );
    }

    /*
     * =====================================================
     * BLOCO DE BROADCAST
     * =====================================================
     *
     * Não ativado nesta versão.
     *
     * A validação acima é a barreira
     * antes de qualquer transmissão.
     * =====================================================
     */

    return json(
      res,
      403,
      {
        success: false,
        error:
          "Broadcast real não está disponível nesta versão de validação."
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
          "Erro interno ao processar a retirada."
      }
    );
  }
}
