const TRON_API = "https://api.shasta.trongrid.io";

const USDT_CONTRACT =
  "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

function tronAddressToHex(address) {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let num = 0n;

  for (const char of address) {
    const value = alphabet.indexOf(char);

    if (value < 0) {
      throw new Error("Endereço TRON inválido.");
    }

    num = num * 58n + BigInt(value);
  }

  let hex = num.toString(16);

  hex = hex.padStart(42, "0");

  if (!hex.startsWith("41")) {
    throw new Error("Endereço TRON inválido.");
  }

  return hex;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido"
    });
  }

  try {
    const address =
      String(req.query.address || "").trim();

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

    const addressHex =
      tronAddressToHex(address);

    const parameter =
      addressHex.padStart(64, "0");

    const response = await fetch(
      `${TRON_API}/wallet/triggerconstantcontract`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          contract_address: USDT_CONTRACT,
          function_selector: "balanceOf(address)",
          parameter,
          owner_address: address,
          visible: true
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok || data.result?.result !== true) {
      console.error(
        "TRON BALANCE ERROR:",
        data
      );

      return res.status(502).json({
        success: false,
        error: "A TRON não conseguiu consultar o saldo."
      });
    }

    const raw =
      data.constant_result?.[0] || "0";

    const units =
      BigInt("0x" + raw);

    // USDT normalmente usa 6 casas decimais.
    const balance =
      Number(units) / 1_000_000;

    return res.status(200).json({
      success: true,
      network: "Shasta Testnet",
      address,
      token: "USDT",
      standard: "TRC-20",
      contract: USDT_CONTRACT,
      balance: balance.toFixed(6),
      rawBalance: units.toString()
    });

  } catch (error) {
    console.error(
      "USDTMZ BLOCKCHAIN ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Erro ao consultar a blockchain."
    });
  }
}
