import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const MAX_WITHDRAWAL_USDT =
  1_000_000;

const NETWORK =
  "TRON Mainnet";

const ASSET =
  "USDT";

/*
 * =========================================================
 * TAXA COMERCIAL USDTMZ
 * =========================================================
 *
 * Exemplo:
 *
 * Pedido: 10 USDT
 * Taxa:    1 USDT
 * Enviado: 9 USDT
 *
 * IMPORTANTE:
 *
 * Esta é a taxa cobrada pelo USDTMZ.
 * Ela NÃO é a mesma coisa que o custo de TRX/Energy
 * da rede TRON.
 *
 * O custo da rede é tratado separadamente abaixo.
 */

const WITHDRAWAL_FEE_USDT = 1;


/*
 * =========================================================
 * MARGEM DE SEGURANÇA ENERGY
 * =========================================================
 *
 * A Energy necessária pode variar.
 *
 * Usamos 20% de margem sobre a estimativa.
 */

const ENERGY_SAFETY_FACTOR = 1.20;


/*
 * =========================================================
 * RESERVA DE BANDWIDTH
 * =========================================================
 *
 * A transação real também precisa de Bandwidth.
 *
 * Não usamos um valor falso de custo exato.
 * Mantemos uma reserva conservadora em bytes.
 */

const BANDWIDTH_RESERVE_BYTES = 1_000;


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

  if (
    !/^\d+(\.\d{1,6})?$/.test(text)
  ) {
    return null;
  }

  const [
    whole,
    decimal = ""
  ] =
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

  const max =
    BigInt(MAX_WITHDRAWAL_USDT) *
    1_000_000n;

  if (raw > max) {
    return null;
  }

  return raw;
}


/*
 * =========================================================
 * FORMAT USDT
 * =========================================================
 */

function formatUsdtAmount(raw) {

  const value =
    BigInt(raw);

  const whole =
    value / 1_000_000n;

  const decimal =
    (
      value %
      1_000_000n
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
 * NUMERIC → RAW USDT
 * =========================================================
 */

function numericToRaw(value) {

  return (
    parseUsdtAmount(value) ||
    0n
  );
}


/*
 * =========================================================
 * TRON REQUEST
 * =========================================================
 */

async function tronRequest(
  endpoint,
  options = {}
) {

  const response =
    await fetch(
      `${TRON_HOST}${endpoint}`,
      {

        ...options,

        headers: {

          "Content-Type":
            "application/json",

          ...(TRONGRID_API_KEY
            ? {
                "TRON-PRO-API-KEY":
                  TRONGRID_API_KEY
              }
            : {}),

          ...(options.headers || {})

        }

      }
    );


  const text =
    await response.text();


  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    data = {
      raw: text
    };

  }


  if (!response.ok) {

    throw new Error(
      `TRONGrid HTTP ${response.status}: ${
        data?.message ||
        data?.Error ||
        text ||
        "erro desconhecido"
      }`
    );

  }


  return data;
}


/*
 * =========================================================
 * TRONWEB
 * =========================================================
 */

function createTronWeb() {

  return new TronWeb({
    fullHost:
      TRON_HOST
  });
}


/*
 * =========================================================
 * ACCOUNT RESOURCE
 * =========================================================
 */

async function getAccountResources(
  address
) {

  return tronRequest(
    "/wallet/getaccountresource",
    {

      method:
        "POST",

      body:
        JSON.stringify({

          address,

          visible:
            true

        })

      }
    );
}


/*
 * =========================================================
 * ACCOUNT
 * =========================================================
 */

async function getAccount(
  address
) {

  return tronRequest(
    "/wallet/getaccount",
    {

      method:
        "POST",

      body:
        JSON.stringify({

          address,

          visible:
            true

        })

      }
    );
}


/*
 * =========================================================
 * CHAIN PARAMETERS
 * =========================================================
 *
 * Precisamos saber quanto TRX a rede cobra por Energy
 * quando a carteira não possui Energy suficiente.
 */

async function getChainParameters() {

  return tronRequest(
    "/wallet/getchainparameters",
    {
      method:
        "GET"
    }
  );
}


/*
 * =========================================================
 * USDT BALANCE REAL
 * =========================================================
 */

async function getUsdtBalance(
  address
) {

  const response =
    await tronRequest(
      `/v1/accounts/${address}`,
      {
        method:
          "GET"
      }
    );


  const account =
    response?.data?.[0];


  const tokens =
    account?.trc20;


  if (
    !Array.isArray(tokens)
  ) {

    return 0n;

  }


  for (
    const token of tokens
  ) {

    if (
      token &&
      Object.prototype.hasOwnProperty.call(
        token,
        USDT_CONTRACT
      )
    ) {

      const raw =
        String(
          token[USDT_CONTRACT] ||
          "0"
        );

      try {

        return BigInt(raw);

      } catch {

        return 0n;

      }

    }

  }


  return 0n;
}


/*
 * =========================================================
 * ENCODE TRANSFER PARAMETER
 * =========================================================
 *
 * transfer(address,uint256)
 *
 * ABI:
 *
 * address = 32 bytes
 * uint256 = 32 bytes
 *
 * O endereço TRON Base58 é convertido para HEX
 * pelo TronWeb.
 */

function buildTransferParameter(
  tronWeb,
  destination,
  rawAmount
) {

  const destinationHex =
    tronWeb.address.toHex(
      destination
    );


  /*
   * TRON HEX começa normalmente com 41.
   *
   * Para ABI usamos os 20 bytes do endereço,
   * removendo o prefixo 41.
   */

  const addressHex =
    destinationHex
      .replace(/^41/, "")
      .padStart(
        64,
        "0"
      );


  const amountHex =
    rawAmount
      .toString(16)
      .padStart(
        64,
        "0"
      );


  return (
    addressHex +
    amountHex
  );
}


/*
 * =========================================================
 * ESTIMAR ENERGY
 * =========================================================
 *
 * Não transmite.
 *
 * triggerconstantcontract é uma simulação.
 */

async function estimateEnergy(
  tronWeb,
  destination,
  rawAmount,
  walletAddress
) {

  const parameter =
    buildTransferParameter(
      tronWeb,
      destination,
      rawAmount
    );


  const response =
    await tronRequest(
      "/wallet/triggerconstantcontract",
      {

        method:
          "POST",

        body:
          JSON.stringify({

            owner_address:
              walletAddress,

            contract_address:
              USDT_CONTRACT,

            function_selector:
              "transfer(address,uint256)",

            parameter,

            call_value:
              0,

            visible:
              true

          })

      }
    );


  if (
    response?.result?.result === false
  ) {

    throw new Error(
      response?.result?.message ||
      "A simulação da transferência TRC-20 falhou."
    );

  }


  const energyUsed =
    Number(
      response?.energy_used ||
      0
    );


  const energyPenalty =
    Number(
      response?.energy_penalty ||
      0
    );


  if (
    !Number.isFinite(
      energyUsed
    ) ||
    energyUsed <= 0
  ) {

    throw new Error(
      "A TRON não devolveu uma estimativa válida de Energy."
    );

  }


  return {

    energy_used:
      energyUsed,

    energy_penalty:
      energyPenalty

  };
}


/*
 * =========================================================
 * CALCULAR RECURSOS
 * =========================================================
 */

function calculateResources(
  resources,
  trxBalance,
  energyEstimate,
  energyFeeSun
) {

  const energyLimit =
    Number(
      resources?.EnergyLimit ||
      0
    );


  const energyUsed =
    Number(
      resources?.EnergyUsed ||
      0
    );


  const energyAvailable =
    Math.max(
      0,
      energyLimit -
      energyUsed
    );


  const netLimit =
    Number(
      resources?.NetLimit ||
      0
    );


  const netUsed =
    Number(
      resources?.NetUsed ||
      0
    );


  const freeNetLimit =
    Number(
      resources?.freeNetLimit ||
      0
    );


  const freeNetUsed =
    Number(
      resources?.freeNetUsed ||
      0
    );


  const normalBandwidthAvailable =
    Math.max(
      0,
      netLimit -
      netUsed
    );


  const freeBandwidthAvailable =
    Math.max(
      0,
      freeNetLimit -
      freeNetUsed
    );


  const totalBandwidthAvailable =
    normalBandwidthAvailable +
    freeBandwidthAvailable;


  /*
   * Energy estimada + margem.
   */

  const estimatedEnergy =
    Math.ceil(
      energyEstimate *
      ENERGY_SAFETY_FACTOR
    );


  /*
   * Energy que não está coberta
   * pelo Energy disponível.
   */

  const energyWithoutCoverage =
    Math.max(
      0,
      estimatedEnergy -
      energyAvailable
    );


  /*
   * TRX necessário para pagar a Energy
   * não coberta.
   *
   * energyFeeSun = Sun por Energy.
   */

  const energyTrxSun =
    BigInt(
      Math.ceil(
        energyWithoutCoverage *
        energyFeeSun
      )
    );


  /*
   * TRX necessário para Energy.
   */

  const energyTrx =
    Number(
      energyTrxSun
    ) /
    1_000_000;


  /*
   * Bandwidth não coberta.
   *
   * Aqui não tentamos inventar um preço fixo.
   * Se a carteira não possui Bandwidth suficiente,
   * mantemos uma reserva TRX para a execução.
   *
   * O fee_limit da transação real também deverá
   * ser controlado no process-withdrawal.
   */

  const bandwidthCovered =
    totalBandwidthAvailable >=
    BANDWIDTH_RESERVE_BYTES;


  /*
   * Reserva mínima adicional de TRX.
   *
   * Não é uma "taxa TRON fixa".
   * É uma margem operacional para evitar
   * tentar transmitir com saldo praticamente zero.
   */

  const bandwidthTrxReserve =
    bandwidthCovered
      ? 0
      : 1;


  const estimatedTrxRequired =
    energyTrx +
    bandwidthTrxReserve;


  const trxSufficient =
    trxBalance >=
    estimatedTrxRequired;


  const energySufficient =
    energyAvailable >=
    estimatedEnergy;


  const resourcesSufficient =
    trxSufficient &&
    (
      energySufficient ||
      energyWithoutCoverage > 0
    );


  return {

    energy: {

      available:
        energyAvailable,

      estimated:
        estimatedEnergy,

      safety_factor:
        ENERGY_SAFETY_FACTOR,

      additional_needed:
        energyWithoutCoverage

    },

    bandwidth: {

      available:
        totalBandwidthAvailable,

      reserve_required:
        BANDWIDTH_RESERVE_BYTES,

      sufficient:
        bandwidthCovered

    },

    trx: {

      balance:
        trxBalance,

      energy_cost_estimate:
        energyTrx,

      bandwidth_reserve:
        bandwidthTrxReserve,

      estimated_required:
        estimatedTrxRequired,

      sufficient:
        trxSufficient

    },

    sufficient:
      resourcesSufficient

  };
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

  if (
    req.method !==
    "POST"
  ) {

    return json(
      res,
      405,
      {
        success:
          false,

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
          success:
            false,

          error:
            "DATABASE_URL não configurada no Vercel."
        }
      );

    }


    if (
      !TRONGRID_API_KEY
    ) {

      return json(
        res,
        500,
        {
          success:
            false,

          error:
            "TRONGRID_API_KEY não configurada no Vercel."
        }
      );

    }


    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * =====================================================
     * BODY
     * =====================================================
     */

    const body =
      req.body || {};


    const address =
      String(
        body.address ||
        ""
      ).trim();


    const amount =
      String(
        body.amount ??
        ""
      ).trim();


    /*
     * =====================================================
     * DESTINO
     * =====================================================
     */

    if (
      !isValidTronAddress(
        address
      )
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "Endereço TRON inválido."
        }
      );

    }


    /*
     * =====================================================
     * VALOR SOLICITADO
     * =====================================================
     */

    const requestedRaw =
      parseUsdtAmount(
        amount
      );


    if (
      requestedRaw ===
      null
    ) {

      return json(
        res,
        400,
        {
          success:
            false,

          error:
            "Valor USDT inválido. Use até 6 casas decimais."
        }
      );

    }


    /*
     * =====================================================
     * TAXA
     * =====================================================
     */

    const feeRaw =
      parseUsdtAmount(
        WITHDRAWAL_FEE_USDT
          .toString()
      );


    if (
      feeRaw ===
      null
    ) {

      return json(
        res,
        500,
        {
          success:
            false,

          error:
            "Configuração da taxa inválida."
        }
      );

    }


    if (
      requestedRaw <=
      feeRaw
    ) {

      return json(
        res,
        400,
        {

          success:
            false,

          error:
            "O valor solicitado deve ser maior que a taxa de retirada.",

          requested:
            formatUsdtAmount(
              requestedRaw
            ),

          fee:
            formatUsdtAmount(
              feeRaw
            )

        }
      );

    }


    /*
     * =====================================================
     * VALORES FINAIS
     * =====================================================
     */

    const amountToSendRaw =
      requestedRaw -
      feeRaw;


    const amountRequested =
      formatUsdtAmount(
        requestedRaw
      );


    const withdrawalFee =
      formatUsdtAmount(
        feeRaw
      );


    const amountToSend =
      formatUsdtAmount(
        amountToSendRaw
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
      wallets.length ===
      0
    ) {

      return json(
        res,
        404,
        {
          success:
            false,

          error:
            "Nenhuma carteira USDT TRON Mainnet configurada."
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
          success:
            false,

          error:
            "A carteira Mainnet configurada é inválida."
        }
      );

    }


    /*
     * =====================================================
     * SALDO INTERNO
     * =====================================================
     */

    const walletRawBalance =
      numericToRaw(
        wallet.balance
      );


    if (
      walletRawBalance <
      requestedRaw
    ) {

      return json(
        res,
        400,
        {

          success:
            false,

          error:
            "Saldo USDT insuficiente para esta retirada.",

          wallet: {

            network:
              NETWORK,

            asset:
              ASSET,

            balance:
              formatUsdtAmount(
                walletRawBalance
              ),

            requested:
              amountRequested,

            fee:
              withdrawalFee,

            amount_to_send:
              amountToSend

          }

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
     * SALDO TRX REAL
     * =====================================================
     */

    const account =
      await getAccount(
        walletAddress
      );


    const trxSun =
      Number(
        account?.balance ||
        0
      );


    const trxBalance =
      trxSun /
      1_000_000;


    /*
     * =====================================================
     * RECURSOS
     * =====================================================
     */

    const resources =
      await getAccountResources(
        walletAddress
      );


    /*
     * =====================================================
     * ESTIMAR ENERGY
     * =====================================================
     *
     * Usamos amountToSend, porque esse é o valor
     * que realmente será transferido.
     */

    const energyEstimate =
      await estimateEnergy(
        tronWeb,
        address,
        amountToSendRaw,
        walletAddress
      );


    /*
     * =====================================================
     * CHAIN PARAMETERS
     * =====================================================
     */

    const chainParameters =
      await getChainParameters();


    let energyFeeSun =
      0;


    const energyFeeParameter =
      chainParameters?.chainParameter?.find(
        item =>
          item?.key ===
          "getEnergyFee"
      );


    if (
      energyFeeParameter
    ) {

      energyFeeSun =
        Number(
          energyFeeParameter.value ||
          0
        );

    }


    if (
      !Number.isFinite(
        energyFeeSun
      ) ||
      energyFeeSun <= 0
    ) {

      return json(
        res,
        503,
        {
          success:
            false,

          error:
            "Não foi possível obter o preço atual da Energy na TRON.",

          trx_balance:
            trxBalance,

          energy_available:
            Number(
              resources?.EnergyLimit ||
              0
            ) -
            Number(
              resources?.EnergyUsed ||
              0
            )

        }
      );

    }


    /*
     * =====================================================
     * CALCULAR RECURSOS
     * =====================================================
     */

    const resourceCheck =
      calculateResources(
        resources,
        trxBalance,
        energyEstimate.energy_used,
        energyFeeSun
      );


    /*
     * =====================================================
     * VERIFICAÇÃO FINAL DE RECURSOS
     * =====================================================
     */

    if (
      !resourceCheck.sufficient
    ) {

      return json(
        res,
        400,
        {

          success:
            false,

          error:
            "A carteira ainda não possui recursos TRON suficientes para executar esta retirada.",

          resources: {

            trx_balance:
              resourceCheck.trx.balance,

            trx_estimated_required:
              resourceCheck.trx.estimated_required,

            trx_sufficient:
              resourceCheck.trx.sufficient,

            energy_available:
              resourceCheck.energy.available,

            energy_estimated:
              resourceCheck.energy.estimated,

            energy_additional_needed:
              resourceCheck.energy.additional_needed,

            bandwidth_available:
              resourceCheck.bandwidth.available,

            bandwidth_required:
              resourceCheck.bandwidth.reserve_required,

            bandwidth_sufficient:
              resourceCheck.bandwidth.sufficient

          },

          estimation: {

            energy_used:
              energyEstimate.energy_used,

            energy_penalty:
              energyEstimate.energy_penalty,

            energy_fee_sun:
              energyFeeSun

          },

          withdrawal: {

            amount_requested:
              amountRequested,

            withdrawal_fee:
              withdrawalFee,

            amount_to_send:
              amountToSend

          }

        }
      );

    }


    /*
     * =====================================================
     * USDT REAL NA BLOCKCHAIN
     * =====================================================
     */

    const blockchainUsdtBalance =
      await getUsdtBalance(
        walletAddress
      );


    if (
      blockchainUsdtBalance <
      amountToSendRaw
    ) {

      return json(
        res,
        400,
        {

          success:
            false,

          error:
            "Saldo USDT real insuficiente na carteira TRON.",

          blockchain_balance:
            formatUsdtAmount(
              blockchainUsdtBalance
            ),

          requested:
            amountToSend,

          amount_requested:
            amountRequested,

          withdrawal_fee:
            withdrawalFee

        }
      );

    }


    /*
     * =====================================================
     * DUPLICAÇÃO
     * =====================================================
     */

    const duplicated =
      await sql`

        SELECT

          id,

          withdrawal_id,

          status

        FROM withdrawals

        WHERE destination_address =
          ${address}

          AND amount_to_send =
          ${amountToSend}

          AND status IN (

            'PENDING',

            'AUTHORIZED',

            'PROCESSING'

          )

        LIMIT 1

      `;


    if (
      duplicated.length >
      0
    ) {

      return json(
        res,
        409,
        {

          success:
            false,

          error:
            "Já existe uma retirada pendente para este endereço e valor.",

          withdrawal: {

            withdrawal_id:
              duplicated[0].withdrawal_id,

            status:
              duplicated[0].status

          }

        }
      );

    }


    /*
     * =====================================================
     * IDENTIFICADORES
     * =====================================================
     */

    const withdrawalId =
      "WD-" +
      Date.now()
        .toString(36)
        .toUpperCase();


    const orderId =
      withdrawalId;


    /*
     * =====================================================
     * CRIAR WITHDRAWAL
     * =====================================================
     */

    const result =
      await sql`

        INSERT INTO withdrawals (

          withdrawal_id,

          destination_address,

          asset,

          network,

          amount,

          status,

          tx_hash,

          order_id,

          amount_requested,

          withdrawal_fee,

          amount_to_send

        )

        VALUES (

          ${withdrawalId},

          ${address},

          ${ASSET},

          ${NETWORK},

          ${amountToSend},

          'PENDING',

          NULL,

          ${orderId},

          ${amountRequested},

          ${withdrawalFee},

          ${amountToSend}

        )

        RETURNING

          id,

          withdrawal_id,

          destination_address,

          asset,

          network,

          amount,

          status,

          tx_hash,

          order_id,

          amount_requested,

          withdrawal_fee,

          amount_to_send,

          created_at,

          updated_at

      `;


    const withdrawal =
      result[0];


    /*
     * =====================================================
     * RESPOSTA
     * =====================================================
     */

    return json(
      res,
      201,
      {

        success:
          true,

        message:
          "Pedido de retirada criado e aguardando autorização.",

        withdrawal: {

          id:
            withdrawal.id,

          withdrawal_id:
            withdrawal.withdrawal_id,

          address:
            withdrawal.destination_address,

          destination_address:
            withdrawal.destination_address,

          amount_requested:
            withdrawal.amount_requested,

          withdrawal_fee:
            withdrawal.withdrawal_fee,

          amount_to_send:
            withdrawal.amount_to_send,

          amount:
            withdrawal.amount,

          asset:
            withdrawal.asset,

          network:
            NETWORK,

          standard:
            "TRC-20",

          contract:
            USDT_CONTRACT,

          status:
            withdrawal.status,

          tx_hash:
            withdrawal.tx_hash,

          broadcasted:
            false,

          wallet_balance:
            formatUsdtAmount(
              walletRawBalance
            ),

          blockchain_usdt_balance:
            formatUsdtAmount(
              blockchainUsdtBalance
            ),

          resources: {

            trx_balance:
              resourceCheck.trx.balance,

            energy_available:
              resourceCheck.energy.available,

            energy_estimated:
              resourceCheck.energy.estimated,

            bandwidth_available:
              resourceCheck.bandwidth.available

          },

          created_at:
            withdrawal.created_at,

          updated_at:
            withdrawal.updated_at

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ WITHDRAWAL ERROR:",
      error?.message ||
      error
    );


    return json(
      res,
      500,
      {

        success:
          false,

        error:
          "Erro interno ao criar o pedido de retirada.",

        details:
          process.env.NODE_ENV ===
          "development"
            ? (
                error?.message ||
                String(error)
              )
            : undefined

      }
    );

  }

}
