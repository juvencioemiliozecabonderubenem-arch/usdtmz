import crypto from "node:crypto";

const API_URL =
  process.env.PAGAR_API_BASE_URL ||
  "https://api.pagar.co.mz/api/v1";

const API_KEY =
  process.env.PAGAR_API_KEY;

const SIGNING_SECRET =
  process.env.PAGAR_SIGNING_SECRET;


/*
 * =========================
 * CONFIGURAÇÃO
 * =========================
 */

function validateConfig() {
  if (!API_KEY) {
    throw new Error(
      "PAGAR_API_KEY não configurada."
    );
  }

  if (!SIGNING_SECRET) {
    throw new Error(
      "PAGAR_SIGNING_SECRET não configurada."
    );
  }

  if (!API_URL) {
    throw new Error(
      "PAGAR_API_BASE_URL não configurada."
    );
  }
}


/*
 * =========================
 * RESPOSTA
 * =========================
 */

async function readResponse(response) {

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Resposta inválida recebida da Pagar API."
    );
  }

  if (!response.ok) {

    const error =
      new Error(
        data?.message ||
        "Pedido rejeitado pela Pagar API."
      );

    error.code =
      data?.error || null;

    error.requestId =
      data?.requestId || null;

    error.httpStatus =
      response.status;

    throw error;
  }

  return data;
}


/*
 * =========================
 * GET
 * =========================
 */

export async function pagarGet(path) {

  validateConfig();

  const url =
    API_URL + path;

  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        "Authorization":
          "Bearer " + API_KEY,

        "Accept":
          "application/json"
      },

      cache:
        "no-store"
    });

  return readResponse(response);
}


/*
 * =========================
 * POST
 * =========================
 */

export async function pagarPost(
  path,
  body,
  idempotencyKey
) {

  validateConfig();

  if (!idempotencyKey) {
    throw new Error(
      "Idempotency-Key é obrigatória."
    );
  }

  const timestamp =
    Date.now().toString();

  const nonce =
    crypto
      .randomBytes(18)
      .toString("base64url");

  const rawBody =
    JSON.stringify(body);

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const url =
    API_URL + path;

  const canonicalPath =
    new URL(url).pathname;

  const canonical =
    [
      timestamp,
      nonce,
      "POST",
      canonicalPath,
      bodyHash
    ].join("\n");

  const signature =
    crypto
      .createHmac(
        "sha256",
        SIGNING_SECRET
      )
      .update(canonical)
      .digest("hex");

  const response =
    await fetch(url, {

      method:
        "POST",

      headers: {

        "Authorization":
          "Bearer " + API_KEY,

        "Content-Type":
          "application/json",

        "Accept":
          "application/json",

        "Idempotency-Key":
          idempotencyKey,

        "X-Pagar-Timestamp":
          timestamp,

        "X-Pagar-Nonce":
          nonce,

        "X-Pagar-Signature":
          "v1=" + signature
      },

      body:
        rawBody,

      cache:
        "no-store"
    });

  return readResponse(response);
}
