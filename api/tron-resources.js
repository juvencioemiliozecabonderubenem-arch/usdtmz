import TronWeb from "tronweb";

const TRON_HOST =
  process.env.TRON_HOST ||
  "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const WALLET_ADDRESS =
  "TVSGrUA6foo527kWL5NiTFBmMX9F38F8A4";

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    if (!process.env.TRONGRID_API_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "TRONGRID_API_KEY não configurada no Vercel."
      });
    }

    if (!isValidTronAddress(WALLET_ADDRESS)) {
      return json(res, 500, {
        success: false,
        error:
          "Endereço da carteira TRON inválido."
      });
    }

    /*
     * =====================================================
     * TRONWEB
     * =====================================================
     */

    const tronWeb = new TronWeb({
      fullHost: TRON_HOST
    });

    /*
     * =====================================================
     * SALDO TRX
     * =====================================================
     */

    const trxSun =
      await tronWeb.trx.getBalance(
        WALLET_ADDRESS
      );

    const trxBalance =
      Number(trxSun) / 1_000_000;

    /*
     * =====================================================
     * ENERGY + BANDWIDTH
     * =====================================================
     */

    const resources =
      await tronWeb.trx.getAccountResources(
        WALLET_ADDRESS
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
        energyLimit - energyUsed
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
        bandwidthLimit - bandwidthUsed
      );

    /*
     * =====================================================
     * USDT REAL
     * =====================================================
     */

    const contract =
      await tronWeb
        .contract()
        .at(
          USDT_CONTRACT
        );

    const rawUsdtBalance =
      await contract
        .balanceOf(
          WALLET_ADDRESS
        )
        .call();

    const usdtBalance =
      Number(
        String(
          rawUsdtBalance
        )
      ) / 1_000_000;

    /*
     * =====================================================
     * RESPOSTA
     * =====================================================
     */

    return json(res, 200, {

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
          energyRemaining

      },

      bandwidth: {

        limit:
          bandwidthLimit,

        used:
          bandwidthUsed,

        available:
          bandwidthRemaining

      },

      broadcasted:
        false

    });

  } catch (error) {

    console.error(
      "USDTMZ TRON RESOURCES ERROR:",
      error?.message ||
      error
    );

    return json(res, 500, {

      success: false,

      error:
        "Não foi possível consultar os recursos da carteira TRON."

    });

  }
}
