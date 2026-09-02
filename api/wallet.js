const TRON_HOST = "https://api.trongrid.io";
const USDT_DECIMALS = 6;

const DEFAULT_USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
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
    /*
     * Aceita os dois nomes para evitar incompatibilidade
     * entre a configuração antiga e a nova da Vercel.
     *
     * Preferência:
     * 1. TRON_WALLET_ADDRESS
     * 2. ENDERECO_DA_CARTEIRA_TRON
     */
    const walletAddress = String(
      process.env.TRON_WALLET_ADDRESS ||
      process.env.ENDERECO_DA_CARTEIRA_TRON ||
      ""
    ).trim();

    const usdtContract = String(
      process.env.USDT_CONTRACT_ADDRESS ||
      DEFAULT_USDT_CONTRACT
    ).trim();

    const apiKey = String(
      process.env.TRONGRID_API_KEY ||
      ""
    ).trim();

    if (!walletAddress) {
      return res.status(500).json({
        success: false,
        error:
          "Endereço da carteira TRON não configurado na Vercel. Configure TRON_WALLET_ADDRESS."
      });
    }

    if (!isValidTronAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON configurado é inválido."
      });
    }

    if (!isValidTronAddress(usdtContract)) {
      return res.status(400).json({
        success: false,
        error: "Contrato USDT configurado é inválido."
      });
    }

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "TRONGRID_API_KEY não configurada na Vercel."
      });
    }

    const url =
      `${TRON_HOST}/v1/accounts/${walletAddress}/trc20/balance` +
      `?contract_address=${encodeURIComponent(usdtContract)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "TRON-PRO-API-KEY": apiKey,
        "Accept": "application/json"
      },
      cache: "no-store"
    });

    let data;

    try {
      data = await response.json();
    } catch {
      return res.status(502).json({
        success: false,
        error:
          "Resposta inválida recebida da TRONGrid."
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
          `TRONGrid HTTP ${response.status}: ` +
          String(
            data?.Error ||
            data?.error ||
            data?.message ||
            "erro desconhecido"
          )
      });
    }

    const tokens = Array.isArray(data?.data)
      ? data.data
      : [];

    const token = tokens.find((item) => {
      const contract = String(
        item?.token_id ||
        item?.contract_address ||
        ""
      ).toLowerCase();

      return (
        contract === usdtContract.toLowerCase()
      );
    });

    const rawBalance = String(
      token?.balance || "0"
    );

    const balance = formatUsdt(rawBalance);

    return res.status(200).json({
      success: true,

      wallet: {
        address: walletAddress,
        network: "TRON Mainnet",
        asset: "USDT",
        standard: "TRC-20",
        contract: usdtContract,

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
      error: "Erro ao consultar a carteira."
    });
  }
}
