const WALLET_ADDRESS = "TRX3XdcZZSv4dVm28yCKmxUHevtRKaoM7R";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  try {
    const apiKey = process.env.TRONGRID_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TRONGRID_API_KEY não configurada"
      });
    }

    const url =
      `https://api.trongrid.io/v1/accounts/${WALLET_ADDRESS}/transactions/trc20` +
      `?limit=1&only_confirmed=true&contract_address=${USDT_CONTRACT}`;

    const response = await fetch(url, {
      headers: {
        "TRON-PRO-API-KEY": apiKey,
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "Erro ao consultar TRON",
        details: data
      });
    }

    /*
     * A API de transações serve para histórico.
     * Para o saldo atual, usamos o endpoint de conta/token.
     */

    const balanceUrl =
      `https://api.trongrid.io/v1/accounts/${WALLET_ADDRESS}` +
      `?only_confirmed=true`;

    const balanceResponse = await fetch(balanceUrl, {
      headers: {
        "TRON-PRO-API-KEY": apiKey,
        "Accept": "application/json"
      }
    });

    const balanceData = await balanceResponse.json();

    if (!balanceResponse.ok) {
      return res.status(balanceResponse.status).json({
        success: false,
        error: "Não foi possível consultar a conta TRON",
        details: balanceData
      });
    }

    let usdtBalance = 0;

    if (Array.isArray(balanceData.data)) {
      const account = balanceData.data[0];

      if (account && Array.isArray(account.trc20)) {
        for (const token of account.trc20) {
          if (token[USDT_CONTRACT] !== undefined) {
            const rawBalance = token[USDT_CONTRACT];

            usdtBalance =
              Number(rawBalance) / 1000000;
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      network: "TRON Mainnet",
      asset: "USDT TRC-20",
      contract: USDT_CONTRACT,
      address: WALLET_ADDRESS,
      balance: usdtBalance,
      source: "TRON blockchain",
      confirmed: true
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Erro interno ao consultar blockchain"
    });
  }
}
