const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY;

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const WALLET_ADDRESS =
  "TVSGrUA6foo527kWL5NiTFBmMX9F38F8A4";

const USDT_DECIMALS = 6;

const TEST_AMOUNTS = [
  2,
  10,
  100,
  500,
  1000
];


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


function usdtToRaw(amount) {

  return BigInt(
    Math.round(
      Number(amount) *
      1_000_000
    )
  );

}


function tronAddressToHex(address) {

  /*
   * TRON Base58Check → hex.
   *
   * A API recebe o endereço TRON
   * normalmente como Base58 quando
   * visible=true.
   */

  return address;

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


async function getResources() {

  return tronRequest(
    "/wallet/getaccountresource",
    {

      method:
        "POST",

      body:
        JSON.stringify({

          address:
            WALLET_ADDRESS,

          visible:
            true

        })

    }
  );

}


async function getAccount() {

  return tronRequest(
    "/wallet/getaccount",
    {

      method:
        "POST",

      body:
        JSON.stringify({

          address:
            WALLET_ADDRESS,

          visible:
            true

        })

    }
  );

}


async function getUsdtBalance() {

  const response =
    await tronRequest(
      `/v1/accounts/${WALLET_ADDRESS}`,
      {
        method: "GET"
      }
    );


  const account =
    response?.data?.[0];


  const tokens =
    account?.trc20;


  if (
    !Array.isArray(tokens)
  ) {
    return 0;
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

      return Number(
        token[USDT_CONTRACT]
      ) /
        1_000_000;

    }

  }


  return 0;

}


async function estimateTransfer(
  destination,
  amount
) {

  /*
   * Para esta etapa usamos uma chamada
   * de simulação.
   *
   * NÃO transmite a transação.
   */

  const response =
    await tronRequest(
      "/wallet/triggerconstantcontract",
      {

        method:
          "POST",

        body:
          JSON.stringify({

            owner_address:
              WALLET_ADDRESS,

            contract_address:
              USDT_CONTRACT,

            function_selector:
              "transfer(address,uint256)",

            parameter:
              buildTransferParameter(
                destination,
                amount
              ),

            call_value:
              0,

            visible:
              true

          })

      }
    );


  return response;

}


function buildTransferParameter(
  destination,
  amount
) {

  /*
   * A conversão Base58 → hex será feita
   * pela própria API usando visible=true
   * quando suportada.
   *
   * Para evitar uma falsa estimativa,
   * não inventamos bytes de endereço aqui.
   */

  throw new Error(
    "A conversão segura do endereço para parâmetro TRON ainda precisa ser configurada."
  );

}


export default async function handler(
  req,
  res
) {

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

    if (!TRONGRID_API_KEY) {

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
            "Carteira TRON inválida."
        }
      );

    }


    /*
     * =====================================================
     * SALDO TRX
     * =====================================================
     */

    const account =
      await getAccount();


    const trx =
      Number(
        account?.balance || 0
      ) /
      1_000_000;


    /*
     * =====================================================
     * RESOURCES
     * =====================================================
     */

    const resources =
      await getResources();


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


    const bandwidthLimit =
      Number(
        resources?.NetLimit || 0
      );


    const bandwidthUsed =
      Number(
        resources?.NetUsed || 0
      );


    const bandwidthAvailable =
      Math.max(
        0,
        bandwidthLimit -
        bandwidthUsed
      );


    /*
     * =====================================================
     * USDT
     * =====================================================
     */

    const usdt =
      await getUsdtBalance();


    /*
     * =====================================================
     * DESTINO DE SIMULAÇÃO
     * =====================================================
     *
     * Não enviamos nada.
     */

    const destination =
      "TVSGrUA6foo527kWL5NiTFBmMX9F38F8A4";


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

        mode:
          "ESTIMATION_ONLY",

        broadcasted:
          false,

        wallet: {

          address:
            WALLET_ADDRESS,

          network:
            "TRON Mainnet",

          usdt_balance:
            usdt,

          trx_balance:
            trx

        },

        resources: {

          energy_available:
            energyAvailable,

          bandwidth_available:
            bandwidthAvailable

        },

        requested_tests:
          TEST_AMOUNTS,

        message:
          "A carteira será apenas analisada. Nenhuma transação será assinada ou transmitida."

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ TRON ESTIMATE ERROR:",
      error
    );


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
