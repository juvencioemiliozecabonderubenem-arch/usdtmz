import { neon } from "@neondatabase/serverless";

const TRON_API = "https://api.trongrid.io";

const USDT_CONTRACT =
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS = 6;

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

function formatAmount(raw) {
  const value = BigInt(String(raw || "0"));
  const divisor = 1000000n;

  const whole = value / divisor;

  const decimals =
    (value % divisor)
      .toString()
      .padStart(USDT_DECIMALS, "0");

  return `${whole}.${decimals}`;
}

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  try {

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "DATABASE_URL não configurada."
      });
    }

    if (!process.env.TRONGRID_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "TRONGRID_API_KEY não configurada."
      });
    }

    const sql =
      neon(process.env.DATABASE_URL);


    /*
     * =========================
     * CARTEIRA MAINNET
     * =========================
     */

    const wallets = await sql`
      SELECT
        id,
        wallet_address
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

    const walletId =
      wallets[0].id;

    const walletAddress =
      String(
        wallets[0].wallet_address || ""
      ).trim();

    if (!isValidTronAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: "Endereço TRON inválido."
      });
    }


    /*
     * =========================
     * TRONGRID
     * =========================
     */

    const url =
      `${TRON_API}/v1/accounts/${walletAddress}/transactions/trc20` +
      `?limit=50` +
      `&only_confirmed=true` +
      `&contract_address=${USDT_CONTRACT}` +
      `&order_by=block_timestamp,desc`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          "TRON-PRO-API-KEY":
            process.env.TRONGRID_API_KEY,
          "Accept": "application/json"
        },
        cache: "no-store"
      });

    const data =
      await response.json();

    if (!response.ok) {

      console.error(
        "TRONGRID TRANSACTIONS ERROR:",
        data
      );

      return res.status(502).json({
        success: false,
        error: "Erro ao consultar transações TRON."
      });
    }


    const blockchainTransactions =
      Array.isArray(data.data)
        ? data.data
        : [];


    /*
     * =========================
     * PROCESSAR DEPÓSITOS
     * =========================
     */

    let saved = 0;

    const deposits = [];


    for (
      const transaction
      of blockchainTransactions
    ) {

      const txHash =
        transaction.transaction_id;

      const from =
        transaction.from;

      const to =
        transaction.to;

      const rawValue =
        transaction.value;

      const blockTimestamp =
        transaction.block_timestamp;


      if (!txHash || !to) {
        continue;
      }


      /*
       * Só aceitamos transferências
       * destinadas à nossa carteira.
       */

      if (
        String(to).toLowerCase() !==
        walletAddress.toLowerCase()
      ) {
        continue;
      }


      /*
       * Confirma que é realmente USDT.
       */

      const contract =
        String(
          transaction.token_info?.address ||
          transaction.contract_address ||
          ""
        ).toLowerCase();

      if (
        contract &&
        contract !==
          USDT_CONTRACT.toLowerCase()
      ) {
        continue;
      }


      const amount =
        formatAmount(rawValue);


      /*
       * =========================
       * EVITAR DUPLICADOS
       * =========================
       */

      const existing =
        await sql`
          SELECT id
          FROM wallet_transactions
          WHERE tx_hash = ${txHash}
          LIMIT 1
        `;


      if (existing.length > 0) {

        deposits.push({
          tx_hash: txHash,
          from,
          to,
          amount,
          status: "already_registered"
        });

        continue;
      }


      /*
       * =========================
       * REGISTRAR DEPÓSITO
       * =========================
       */

      const createdAt =
        blockTimestamp
          ? new Date(
              Number(blockTimestamp)
            )
          : new Date();


      await sql`
        INSERT INTO wallet_transactions (
          wallet_id,
          order_id,
          tx_hash,
          type,
          asset,
          amount,
          network,
          status,
          created_at
        )
        VALUES (
          ${walletId},
          NULL,
          ${txHash},
          'deposit',
          'USDT',
          ${amount},
          'TRON Mainnet',
          'confirmed',
          ${createdAt}
        )
      `;


      saved++;

      deposits.push({
        tx_hash: txHash,
        from,
        to,
        amount,
        status: "saved"
      });
    }


    /*
     * =========================
     * HISTÓRICO LOCAL
     * =========================
     */

    const transactions =
      await sql`
        SELECT
          wt.id,
          wt.order_id,
          wt.tx_hash,
          wt.type,
          wt.asset,
          wt.amount,
          wt.network,
          wt.status,
          wt.created_at,
          w.wallet_address
        FROM wallet_transactions wt
        LEFT JOIN wallets w
          ON w.id = wt.wallet_id
        WHERE wt.wallet_id = ${walletId}
        ORDER BY wt.created_at DESC
        LIMIT 100
      `;


    return res.status(200).json({

      success: true,

      network:
        "TRON Mainnet",

      asset:
        "USDT TRC-20",

      wallet:
        walletAddress,

      blockchain_found:
        blockchainTransactions.length,

      new_deposits:
        saved,

      deposits,

      transactions

    });

  } catch (error) {

    console.error(
      "USDTMZ TRANSACTIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Não foi possível monitorar as transações."
    });
  }
}
