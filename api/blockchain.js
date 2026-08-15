const TRONGRID_URL = "https://api.shasta.trongrid.io";

const TEST_USDT_CONTRACT =
  "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Informe um endereço TRON."
      });
    }

    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    const url =
      `${TRONGRID_URL}/v1/accounts/${address}/transactions/trc20` +
      `?only_confirmed=false` +
      `&limit=20` +
      `&contract_address=${TEST_USDT_CONTRACT}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "Não foi possível consultar as transações TRC20."
      });
    }

    return res.status(200).json({
      success: true,
      network: "Shasta Testnet",
      address,
      token: {
        symbol: "USDT-TEST",
        contract: TEST_USDT_CONTRACT
      },
      transactions: data.data || []
    });

  } catch (error) {
    console.error("USDTMZ BLOCKCHAIN ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Erro ao consultar a blockchain."
    });
  }
}
