const TRON_API = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

const WALLET_ADDRESS =
  "TVSGrUA6foo527kWL5NiTFBmMX9F38F8A4";

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function formatUsdtBalance(rawBalance) {
  try {
    const raw = BigInt(String(rawBalance || "0"));
    const divisor = 1000000n;

    const whole = raw / divisor;

    const decimal =
      (raw % divisor)
        .toString()
        .padStart(USDT_DECIMALS, "0");

    return `${whole}.${decimal}`;
  } catch {
    return "0.000000";
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  try {
    if (!isValidTronAddress(WALLET_ADDRESS)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    const apiKey =
      process.env.TRONGRID_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TRONGRID_API_KEY não configurada."
      });
    }

    const url =
      `${TRON_API}/v1/accounts/${WALLET_ADDRESS}/trc20/balance` +
      `?contract_address=${USDT_CONTRACT}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "TRON-PRO-API-KEY": apiKey
      },
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "TRONGRID BALANCE ERROR:",
        response.status,
        data
      );

      return res.status(502).json({
        success: false,
        error: "TRONGrid rejeitou a consulta.",
        tronGridStatus: response.status
      });
    }

    const items =
      Array.isArray(data?.data)
        ? data.data
        : [];

    const token =
      items.find((item) =>
        String(
          item?.token_id ||
          item?.contract_address ||
          ""
        ).toLowerCase() ===
        USDT_CONTRACT.toLowerCase()
      ) || items[0];

    const rawBalance =
      String(token?.balance || "0");

    const balance =
      formatUsdtBalance(rawBalance);

    return res.status(200).json({
      success: true,

      wallet: {
        address: WALLET_ADDRESS,
        network: "TRON Mainnet",
        asset: "USDT",
        standard: "TRC-20",
        contract: USDT_CONTRACT,

        connected: true,
        configured: true,

        balance,
        balanceRaw: rawBalance,

        confirmed: true,
        source: "TRONGrid"
      }
    });

  } catch (error) {
    console.error(
      "USDTMZ BLOCKCHAIN ERROR:",
      error?.message || error
    );

    return res.status(500).json({
      success: false,
      error: "Erro interno ao consultar a blockchain."
    });
  }
}
