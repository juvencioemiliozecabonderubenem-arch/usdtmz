const TRON_API = "https://api.trongrid.io";

// USDT TRC-20 oficial na TRON Mainnet
const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function tronAddressToHex(address) {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let num = 0n;

  for (const char of address) {
    const value = alphabet.indexOf(char);

    if (value === -1) {
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
      error: "Método não permitido."
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

    /*
     * balanceOf(address)
     *
     * O parâmetro precisa ser ABI encoded.
     */
    const parameter =
      addressHex.slice(2).padStart(64, "0");

    const response = await fetch(
      `${TRON_API}/wallet/triggerconstantcontract`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },

        body: JSON.stringify({

          contract_address:
            USDT_CONTRACT,

          function_selector:
            "balanceOf(address)",

          parameter,

          owner_address:
            address,

          visible: true

        })
      }
    );

    const data =
      await response.json();

    if (!response.ok) {

      console.error(
        "TRON API ERROR:",
        data
      );

      return res.status(502).json({
        success: false,
        error: "Erro ao consultar a TRON Mainnet."
      });
    }

    if (
      !data.result ||
      data.result.result !== true ||
      !data.constant_result ||
      !data.constant_result[0]
    ) {

      console.error(
        "TRON CONTRACT ERROR:",
        data
      );

      return res.status(502).json({
        success: false,
        error: "Não foi possível obter o saldo USDT."
      });
    }

    const rawBalance =
      data.constant_result[0];

    const units =
      BigInt("0x" + rawBalance);

    /*
     * USDT TRC-20 utiliza 6 casas decimais.
     */
    const whole =
      units / 1000000n;

    const decimals =
      (units % 1000000n)
        .toString()
        .padStart(6, "0");

    const balance =
      `${whole}.${decimals}`;

    return res.status(200).json({

      success: true,

      network:
        "TRON Mainnet",

      token:
        "USDT",

      standard:
        "TRC-20",

      contract:
        USDT_CONTRACT,

      address,

      balance,

      rawBalance:
        units.toString()

    });

  } catch (error) {

    console.error(
      "USDTMZ BLOCKCHAIN ERROR:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Erro interno ao consultar a blockchain."

    });
  }
}
