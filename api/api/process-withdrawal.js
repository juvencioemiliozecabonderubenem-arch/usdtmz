import { neon } from "@neondatabase/serverless";
import TronWeb from "tronweb";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NETWORK = "TRON Mainnet";
const ASSET = "USDT";
const USDT_DECIMALS = 6;

const TRON_HOST =
  "https://api.trongrid.io";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

function parseUsdt(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }

  const [whole, decimal = ""] = text.split(".");
  const padded = decimal.padEnd(6, "0");

  const raw =
    BigInt(whole) * 1_000_000n +
    BigInt(padded);

  return raw > 0n ? raw : null;
}

function formatUsdt(raw) {
  const value = BigInt(raw);

  const whole = value / 1_000_000n;

  const decimal =
    (value % 1_000_000n)
      .toString()
      .padStart(6, "0");

  return `${whole}.${decimal}`;
}

function createTronWeb() {
  const apiKey = process.env.TRONGRID_API_KEY;

  if (!apiKey) {
    throw new Error(
      "TRONGRID_API_KEY não configurada."
    );
  }

  const privateKey =
    process.env.TRON_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      "TRON_PRIVATE_KEY não configurada."
    );
  }

  return new TronWeb({
    fullHost: TRON_HOST,
    headers: {
      "TRON-PRO-API-KEY": apiKey
    },
    privateKey
  });
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    if (!process.env.DATABASE_URL) {
      return json(res, 500, {
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    if (!process.env.TRONGRID_API_KEY) {
      return json(res, 500, {
        success: false,
        error: "TRONGRID_API_KEY não configurada."
      });
    }

    if (!process.env.TRON_PRIVATE_KEY) {
      return json(res, 500, {
        success: false,
        error: "TRON_PRIVATE_KEY não configurada."
      });
    }

    const body = req.body || {};

    const withdrawalId =
      String(
        body.withdrawal_id ||
        body.withdrawalId ||
        ""
      ).trim();

    if (!withdrawalId) {
      return json(res, 400, {
        success: false,
        error: "withdrawal_id é obrigatório."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);

    /*
     * =====================================================
     * LOCALIZAR RETIRADA
     * =====================================================
     */

    const withdrawals = await sql`
      SELECT
        id,
        withdrawal_id,
        destination_address,
        asset,
        network,
        amount,
        status,
        tx_hash,
        created_at,
        updated_at,
        order_id
      FROM withdrawals
      WHERE withdrawal_id = ${withdrawalId}
      LIMIT 1
    `;

    if (withdrawals.length === 0) {
      return json(res, 404, {
        success: false,
        error: "Retirada não encontrada."
      });
    }

    const withdrawal = withdrawals[0];

    /*
     * =====================================================
     * NÃO PROCESSAR NOVAMENTE UMA RETIRADA FINALIZADA
     * =====================================================
     */

    if (
      withdrawal.status === "COMPLETED"
    ) {
      return json(res, 409, {
        success: false,
        error: "Esta retirada já foi concluída.",
        withdrawal_id: withdrawal.withdrawal_id,
        status: withdrawal.status,
        tx_hash: withdrawal.tx_hash
      });
    }

    if (
      withdrawal.status === "FAILED"
    ) {
      return json(res, 409, {
        success: false,
        error: "Esta retirada está marcada como FAILED.",
        withdrawal_id: withdrawal.withdrawal_id,
        status: withdrawal.status
      });
    }

    /*
     * =====================================================
     * VALIDAR REDE / ASSET
     * =====================================================
     */

    if (
      String(withdrawal.network) !== NETWORK ||
      String(withdrawal.asset).toUpperCase() !== ASSET
    ) {
      return json(res, 400, {
        success: false,
        error:
          "A retirada não está configurada para USDT TRON Mainnet."
      });
    }

    /*
     * =====================================================
     * VALIDAR DESTINO
     * =====================================================
     */

    const destination =
      String(
        withdrawal.destination_address || ""
      ).trim();

    if (!isValidTronAddress(destination)) {
      return json(res, 400, {
        success: false,
        error: "Endereço TRON de destino inválido."
      });
    }

    /*
     * =====================================================
     * VALIDAR VALOR
     * =====================================================
     */

    const rawAmount =
      parseUsdt(withdrawal.amount);

    if (rawAmount === null) {
      return json(res, 400, {
        success: false,
        error: "Valor USDT inválido na retirada."
      });
    }

    /*
     * =====================================================
     * TRONWEB
     * =====================================================
     */

    const tronWeb = createTronWeb();

    /*
     * =====================================================
     * CARTEIRA INTERNA
     * =====================================================
     */

    const wallets = await sql`
      SELECT
        id,
        wallet_address,
        network,
        asset,
        balance,
        status
      FROM wallets
      WHERE network = ${NETWORK}
        AND asset = ${ASSET}
        AND status = 'mainnet'
      ORDER BY id DESC
      LIMIT 1
    `;

    if (wallets.length === 0) {
      return json(res, 404, {
        success: false,
        error:
          "Carteira TRON Mainnet não encontrada."
      });
    }

    const wallet = wallets[0];

    const sender =
      String(
        wallet.wallet_address || ""
      ).trim();

    if (!isValidTronAddress(sender)) {
      return json(res, 500, {
        success: false,
        error:
          "Endereço da carteira Mainnet inválido."
      });
    }

    /*
     * =====================================================
     * GARANTIR QUE A PRIVATE KEY PERTENCE À CARTEIRA
     * =====================================================
     */

    const derivedAddress =
      tronWeb.address.fromPrivateKey(
        process.env.TRON_PRIVATE_KEY
      );

    if (!derivedAddress) {
      return json(res, 500, {
        success: false,
        error:
          "Não foi possível derivar o endereço da chave privada."
      });
    }

    if (
      derivedAddress !== sender
    ) {
      return json(res, 500, {
        success: false,
        error:
          "A TRON_PRIVATE_KEY não corresponde à carteira Mainnet configurada."
      });
    }

    /*
     * =====================================================
     * SALDO TRX REAL
     * =====================================================
     */

    const trxSun =
      await tronWeb.trx.getBalance(sender);

    const trx =
      Number(trxSun) / 1_000_000;

    /*
     * =====================================================
     * SALDO USDT REAL
     * =====================================================
     */

    const contract =
      await tronWeb.contract().at(
        USDT_CONTRACT
      );

    const usdtRaw =
      await contract
        .balanceOf(sender)
        .call();

    const usdtBalance =
      BigInt(
        String(usdtRaw)
      );

    /*
     * =====================================================
     * VERIFICAR SALDO USDT
     * =====================================================
     */

    if (
      usdtBalance < rawAmount
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Saldo USDT real insuficiente na carteira Mainnet.",
        wallet: {
          address: sender,
          usdt_balance:
            formatUsdt(usdtBalance),
          requested:
            formatUsdt(rawAmount),
          trx_balance: trx
        }
      });
    }

    /*
     * =====================================================
     * TESTE DE CONSTRUÇÃO
     * =====================================================
     *
     * NÃO fazemos:
     *
     * send()
     * broadcast()
     *
     * Portanto nenhum USDT é enviado.
     */

    const transaction =
      await contract.transfer(
        destination,
        rawAmount.toString()
      ).build();

    /*
     * =====================================================
     * RESULTADO
     * =====================================================
     */

    return json(res, 200, {
      success: true,

      mode: "VALIDATION_ONLY",

      broadcasted: false,

      message:
        "Motor TRON validado. Nenhuma transação foi transmitida.",

      withdrawal: {
        withdrawal_id:
          withdrawal.withdrawal_id,

        status:
          withdrawal.status,

        destination_address:
          destination,

        amount:
          formatUsdt(rawAmount),

        asset:
          ASSET,

        network:
          NETWORK,

        contract:
          USDT_CONTRACT
      },

      wallet: {
        address:
          sender,

        usdt_balance:
          formatUsdt(usdtBalance),

        trx_balance:
          trx
      },

      transaction: {
        built:
          Boolean(transaction),

        broadcasted:
          false
      }
    });

  } catch (error) {

    console.error(
      "USDTMZ PROCESS WITHDRAWAL ERROR:",
      error?.message || error
    );

    return json(res, 500, {
      success: false,
      error:
        "Erro interno no motor TRON.",
      details:
        error?.message || null
    });
  }
}
