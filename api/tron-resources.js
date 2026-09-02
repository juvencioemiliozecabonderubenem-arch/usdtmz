const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY;

const WALLET_ADDRESS =
  process.env.TRON_WALLET_ADDRESS;

const USDT_CONTRACT =
  process.env.USDT_CONTRACT_ADDRESS ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;


/* =========================================================
   JSON
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
   VALIDAR ENDEREÇO TRON
========================================================= */

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}


/* =========================================================
   FORMATAR USDT
========================================================= */

function formatUsdt(raw) {
  try {
    const value = BigInt(
      String(raw ?? "0")
    );

    const divisor = 10n ** BigInt(
      USDT_DECIMALS
    );

    const whole =
      value / divisor;

    const fraction =
      (value % divisor)
        .toString()
        .padStart(
          USDT_DECIMALS,
          "0"
        );

    return `${whole}.${fraction}`;

  } catch {
    return "0.000000";
  }
}


/* =========================================================
   TRONGRID REQUEST
========================================================= */

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

          Accept:
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


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  /* =======================================================
     MÉTODO
  ======================================================= */

  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
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

    /* =====================================================
       CONFIGURAÇÕES
    ===================================================== */

    if (!TRONGRID_API_KEY) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRONGRID_API_KEY não configurada no Vercel."
        }
      );
    }

    if (!WALLET_ADDRESS) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRON_WALLET_ADDRESS não configurada no Vercel."
        }
      );
    }

    if (
      !isValidTronAddress(
        WALLET_ADDRESS
      )
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "TRON_WALLET_ADDRESS inválida."
        }
      );
    }

    if (
      !isValidTronAddress(
        USDT_CONTRACT
      )
    ) {
      return json(
        res,
        500,
        {
          success: false,
          error:
            "USDT_CONTRACT_ADDRESS inválido."
        }
      );
    }


    /* =====================================================
       CONTA TRON
    ===================================================== */

    const account =
      await tronRequest(
        "/wallet/getaccount",
        {
          method: "POST",

          body: JSON.stringify({
            address:
              WALLET_ADDRESS,

            visible:
              true
          })
        }
      );


    /* =====================================================
       SALDO TRX
    ===================================================== */

    const trxSun =
      Number(
        account?.balance || 0
      );

    const trxBalance =
      trxSun / 1_000_000;


    /* =====================================================
       ENERGY / BANDWIDTH
    ===================================================== */

    const resources =
      await tronRequest(
        "/wallet/getaccountresource",
        {
          method: "POST",

          body: JSON.stringify({
            address:
              WALLET_ADDRESS,

            visible:
              true
          })
        }
      );


    const energyLimit =
      Number(
        resources?.EnergyLimit || 0
      );

    const energyUsed =
      Number(
        resources?.EnergyUsed || 0
      );

    const energyAvailable =
      Math.max(
        0,
        energyLimit -
        energyUsed
      );


    /* =====================================================
       BANDWIDTH NORMAL
    ===================================================== */

    const netLimit =
      Number(
        resources?.NetLimit || 0
      );

    const netUsed =
      Number(
        resources?.NetUsed || 0
      );

    const normalAvailable =
      Math.max(
        0,
        netLimit -
        netUsed
      );


    /* =====================================================
       BANDWIDTH FREE
    ===================================================== */

    const freeNetLimit =
      Number(
        resources?.freeNetLimit || 0
      );

    const freeNetUsed =
      Number(
        resources?.freeNetUsed || 0
      );

    const freeAvailable =
      Math.max(
        0,
        freeNetLimit -
        freeNetUsed
      );


    const totalBandwidthAvailable =
      normalAvailable +
      freeAvailable;


    /* =====================================================
       SALDO USDT TRC-20
    ===================================================== */

    const accountData =
      await tronRequest(
        `/v1/accounts/${encodeURIComponent(
          WALLET_ADDRESS
        )}`,
        {
          method: "GET"
        }
      );


    let usdtBalanceRaw =
      "0";


    const accountList =
      Array.isArray(
        accountData?.data
      )
        ? accountData.data
        : [];


    const trc20 =
      accountList[0]?.trc20;


    if (
      Array.isArray(trc20)
    ) {

      for (
        const token of trc20
      ) {

        if (
          token &&
          Object.prototype.hasOwnProperty.call(
            token,
            USDT_CONTRACT
          )
        ) {

          usdtBalanceRaw =
            String(
              token[USDT_CONTRACT]
            );

          break;
        }
      }
    }


    const usdtBalance =
      formatUsdt(
        usdtBalanceRaw
      );


    /* =====================================================
       RESPOSTA
    ===================================================== */

    return json(
      res,
      200,
      {
        success: true,

        wallet: {
          address:
            WALLET_ADDRESS,

          network:
            "TRON Mainnet",

          asset:
            "USDT",

          standard:
            "TRC-20",

          contract:
            USDT_CONTRACT
        },

        balances: {
          trx:
            trxBalance,

          usdt:
            usdtBalance
        },

        energy: {
          limit:
            energyLimit,

          used:
            energyUsed,

          available:
            energyAvailable
        },

        bandwidth: {
          normal_limit:
            netLimit,

          normal_used:
            netUsed,

          normal_available:
            normalAvailable,

          free_limit:
            freeNetLimit,

          free_used:
            freeNetUsed,

          free_available:
            freeAvailable,

          total_available:
            totalBandwidthAvailable
        },

        broadcasted:
          false
      }
    );

  } catch (error) {

    console.error(
      "USDTMZ TRON RESOURCES ERROR:",
      error?.message ||
      error
    );

    return json(
      res,
      502,
      {
        success: false,
        error:
          "Não foi possível consultar os recursos da carteira TRON.",
        details:
          error?.message ||
          "Erro desconhecido."
      }
    );
  }
}
