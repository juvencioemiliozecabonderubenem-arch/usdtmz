const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY;

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const WALLET_ADDRESS =
  "TVSGrUA6foo527kWL5NiTFBmMX9F38F8A4";


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

          "TRON-PRO-API-KEY":
            TRONGRID_API_KEY,

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


export default async function handler(
  req,
  res
) {

  /*
   * =====================================================
   * MÉTODO
   * =====================================================
   */

  if (req.method !== "GET") {

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
     * API KEY
     * =====================================================
     */

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


    /*
     * =====================================================
     * ENDEREÇO
     * =====================================================
     */

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
            "Endereço da carteira TRON inválido."
        }
      );

    }


    /*
     * =====================================================
     * CONVERTER ENDEREÇO PARA HEX
     * =====================================================
     */

    const addressResponse =
      await tronRequest(
        `/wallet/getaccount`,
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


    /*
     * =====================================================
     * SALDO TRX
     * =====================================================
     */

    const accountResponse =
      await tronRequest(
        `/wallet/getaccount`,
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


    const trxSun =
      Number(
        accountResponse?.balance || 0
      );


    const trxBalance =
      trxSun / 1_000_000;


    /*
     * =====================================================
     * ENERGY + BANDWIDTH
     * =====================================================
     */

    const resources =
      await tronRequest(
        `/wallet/getaccountresource`,
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


    const energyRemaining =
      Math.max(
        0,
        energyLimit -
        energyUsed
      );


    /*
     * =====================================================
     * BANDWIDTH
     * =====================================================
     */

    const netLimit =
      Number(
        resources?.NetLimit || 0
      );


    const netUsed =
      Number(
        resources?.NetUsed || 0
      );


    const freeNetLimit =
      Number(
        resources?.freeNetLimit || 0
      );


    const freeNetUsed =
      Number(
        resources?.freeNetUsed || 0
      );


    const normalBandwidthRemaining =
      Math.max(
        0,
        netLimit -
        netUsed
      );


    const freeBandwidthRemaining =
      Math.max(
        0,
        freeNetLimit -
        freeNetUsed
      );


    const totalBandwidthRemaining =
      normalBandwidthRemaining +
      freeBandwidthRemaining;


    /*
     * =====================================================
     * USDT
     * =====================================================
     *
     * Consulta direta do contrato TRC-20.
     */

    const contractAddressHex =
      "41" +
      USDT_CONTRACT
        ? null
        : null;


    /*
     * Usamos /v1/accounts para obter
     * os TRC-20 associados à carteira.
     */

    const accountData =
      await tronRequest(
        `/v1/accounts/${WALLET_ADDRESS}`,
        {
          method: "GET"
        }
      );


    let usdtBalanceRaw =
      0;


    const trc20 =
      accountData?.data?.[0]?.trc20;


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
            Number(
              token[USDT_CONTRACT]
            );

          break;

        }

      }

    }


    const usdtBalance =
      usdtBalanceRaw /
      1_000_000;


    /*
     * =====================================================
     * RESPOSTA
     * =====================================================
     */

    return json(
      res,
      200,
      {

        success:
          true,

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
            energyRemaining

        },

        bandwidth: {

          normal_limit:
            netLimit,

          normal_used:
            netUsed,

          normal_available:
            normalBandwidthRemaining,

          free_limit:
            freeNetLimit,

          free_used:
            freeNetUsed,

          free_available:
            freeBandwidthRemaining,

          total_available:
            totalBandwidthRemaining

        },

        broadcasted:
          false

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ TRON RESOURCES ERROR:",
      error
    );


    /*
     * Durante o diagnóstico mostramos
     * a mensagem real do erro.
     */

    return json(
      res,
      500,
      {

        success:
          false,

        error:
          error?.message ||
          String(error) ||
          "Erro desconhecido."

      }
    );

  }

}
