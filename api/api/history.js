const TRON_API = "https://api.trongrid.io";

// USDT TRC-20 Mainnet
const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    const address =
      String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON não informado."
      });
    }

    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    const url =
      `${TRON_API}/v1/accounts/${address}/transactions/trc20` +
      `?only_confirmed=true` +
      `&limit=50` +
      `&contract_address=${USDT_CONTRACT}` +
      `&order_by=block_timestamp,desc`;

    const response =
      await fetch(url, {
        headers: {
          "Accept": "application/json"
        }
      });

    const data =
      await response.json();

    if (!response.ok) {

      console.error(
        "TRONGRID ERROR:",
        data
      );

      return res.status(502).json({
        success: false,
        error:
          "Não foi possível consultar o histórico da TRON."
      });
    }

    const transactions =
      Array.isArray(data.data)
        ? data.data
        : [];

    const history =
      transactions.map(tx => {

        const from =
          tx.from || "";

        const to =
          tx.to || "";

        const rawValue =
          BigInt(tx.value || "0");

        const whole =
          rawValue / 1000000n;

        const decimals =
          (rawValue % 1000000n)
            .toString()
            .padStart(6, "0");

        const amount =
          `${whole}.${decimals}`;

        let type = "OUT";

        if (
          to.toLowerCase() ===
          address.toLowerCase()
        ) {
          type = "IN";
        }

        return {

          txID:
            tx.transaction_id || null,

          type,

          from,

          to,

          amount,

          token:
            tx.token_info?.symbol || "USDT",

          block_timestamp:
            tx.block_timestamp || null,

          confirmed:
            true

        };

      });

    return res.status(200).json({

      success: true,

      network:
        "TRON Mainnet",

      standard:
        "TRC-20",

      asset:
        "USDT",

      address,

      contract:
        USDT_CONTRACT,

      count:
        history.length,

      history

    });

  } catch (error) {

    console.error(
      "USDTMZ HISTORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Erro interno ao consultar o histórico."
    });
  }
}
