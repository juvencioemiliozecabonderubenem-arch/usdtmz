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

    // Validação básica de endereço TRON
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }

    const url =
      `https://api.shasta.trongrid.io/v1/accounts/${address}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("TRONGRID ERROR:", data);

      return res.status(response.status).json({
        success: false,
        error: "A rede TRON não respondeu corretamente."
      });
    }

    const account = data.data?.[0] || null;

    return res.status(200).json({
      success: true,
      network: "Shasta Testnet",
      address,
      account: account || {
        address,
        activated: false
      },
      blockchain: data
    });

  } catch (error) {
    console.error("USDTMZ BLOCKCHAIN ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Erro ao consultar a blockchain."
    });
  }
}
