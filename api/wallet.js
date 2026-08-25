const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;
const TRON_HOST = "https://api.trongrid.io";

const WALLET_ADDRESS =
  "TVSGrUA6foo527kWL5NiTFBmMX9F38F8A4";

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function formatUsdt(rawBalance) {
  try {
    const value = BigInt(String(rawBalance || "0"));
    const base = 10n ** BigInt(USDT_DECIMALS);

    const whole = value / base;

    const decimal = (value % base)
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
        error: "Endereço TRON configurado é inválido."
      });
    }

    const apiKey = process.env.TRONGRID_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TRONGRID_API_KEY não configurada no Vercel."
      });
    }

    const url =
      `${TRON_HOST}/v1/accounts/${WALLET_ADDRESS}/tokens` +
      `?only_confirmed=true` +
      `&contract_address=${USDT_CONTRACT}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "TRON-PRO-API-KEY": apiKey,
        "Accept": "application/json"
      }
    });

    let data;

    try {
      data = await response.json();
    } catch {
      return res.status(502).json({
        success: false,
        error: "Resposta inválida recebida da TRONGrid."
      });
    }

    if (!response.ok) {
      console.error(
        "TRONGRID ERROR:",
        response.status,
        data
      );

      return res.status(502).json({
        success: false,
        error:
          "TRONGrid HTTP " +
          response.status +
          ": " +
          String(
            data?.Error ||
            data?.error ||
            "erro desconhecido"
          )
      });
    }

    const tokens =
      Array.isArray(data?.data)
        ? data.data
        : [];

    const token = tokens.find((item) => {
      const contract =
        String(
          item?.token_id ||
          item?.contract_address ||
          ""
        ).toLowerCase();

      return (
        contract ===
        USDT_CONTRACT.toLowerCase()
      );
    });

    const rawBalance =
      String(token?.balance || "0");

    const balance =
      formatUsdt(rawBalance);

    return res.status(200).json({
      success: true,

      wallet: {
        address: WALLET_ADDRESS,
        network: "TRON Mainnet",
        asset: "USDT",
        standard: "TRC-20",
        contract: USDT_CONTRACT,

        configured: true,
        connected: true,

        balance,
        balanceRaw: rawBalance,

        balanceSource: "TRONGrid",
        confirmed: true
      }
    });

  } catch (error) {
    console.error(
      "USDTMZ WALLET ERROR:",
      error?.message || error
    );

    return res.status(500).json({
      success: false,
      error:
        "Erro ao consultar a carteira."
    });
  }
}
