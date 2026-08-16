import { neon } from "@neondatabase/serverless";

const TRON_API = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function formatUsdtBalance(rawBalance) {
  const raw = BigInt(String(rawBalance || "0"));

  const divisor = 1000000n;

  const whole = raw / divisor;

  const decimal =
    (raw % divisor)
      .toString()
      .padStart(USDT_DECIMALS, "0");

  return `${whole}.${decimal}`;
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
     * =========================
     * BANCO DE DADOS
     * =========================
     */

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);


    /*
     * =========================
     * OBTER CARTEIRA MAINNET
     * =========================
     */

    const wallets = await sql`
      SELECT wallet_address
      FROM wallets
      WHERE network = 'TRON Mainnet'
        AND asset = 'USDT'
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;


    if (wallets.length === 0) {

      return res.status(404).json({
        success: false,
        error: "Nenhuma carteira TRON Mainnet configurada."
      });

    }


    const address =
      String(wallets[0].wallet_address || "").trim();


    if (!isValidTronAddress(address)) {

      return res.status(400).json({
        success: false,
        error: "O endereço TRON configurado é inválido."
      });

    }


    /*
     * =========================
     * CONSULTA REAL TRON
     * =========================
     */

    const accountUrl =
      `${TRON_API}/v1/accounts/${address}` +
      `?only_confirmed=true`;


    const headers = {
      "Accept": "application/json"
    };


    /*
     * Se existir API key no Vercel,
     * ela é enviada para o TronGrid.
     */

    if (process.env.TRONGRID_API_KEY) {

      headers["TRON-PRO-API-KEY"] =
        process.env.TRONGRID_API_KEY;

    }


    const response =
      await fetch(accountUrl, {
        method: "GET",
        headers,
        cache: "no-store"
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
        error: "Não foi possível consultar a TRON Mainnet."
      });

    }


    /*
     * =========================
     * LOCALIZAR USDT TRC-20
     * =========================
     */

    let balance =
      "0.000000";


    const account =
      Array.isArray(data.data)
        ? data.data[0]
        : null;


    if (
      account &&
      Array.isArray(account.trc20)
    ) {

      for (const token of account.trc20) {

        if (!token || typeof token !== "object") {
          continue;
        }


        /*
         * O TronGrid normalmente devolve
         * o contrato como chave do objeto.
         */

        const rawBalance =
          token[USDT_CONTRACT];


        if (rawBalance !== undefined) {

          balance =
            formatUsdtBalance(rawBalance);

          break;

        }

      }

    }


    /*
     * =========================
     * RESPOSTA
     * =========================
     */

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

      confirmed:
        true,

      source:
        "TRON Mainnet / TronGrid"

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
