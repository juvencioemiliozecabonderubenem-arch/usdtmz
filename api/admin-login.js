import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

/*
 * =========================================================
 * USDTMZ — ADMIN LOGIN
 * =========================================================
 *
 * Arquivo:
 * /api/admin-login.js
 *
 * POST /api/admin-login
 *
 * Body:
 * {
 *   "email": "admin@exemplo.com",
 *   "password": "SENHA"
 * }
 *
 * Fluxo:
 *
 * email + senha
 *      ↓
 * procurar admin_users
 *      ↓
 * verificar password_hash
 *      ↓
 * criar sessão aleatória
 *      ↓
 * cookie HTTP-only
 *
 * IMPORTANTE:
 *
 * Este arquivo NÃO armazena senha em texto.
 * A senha deve estar armazenada como hash.
 *
 * =========================================================
 */


/*
 * =========================================================
 * CONFIGURAÇÃO
 * =========================================================
 */

const SESSION_COOKIE =
  "usdtmz_admin_session";

const SESSION_MAX_AGE =
  60 * 60 * 8; // 8 horas


/*
 * =========================================================
 * JSON
 * =========================================================
 */

function json(res, status, data) {

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(status)
    .json(data);
}


/*
 * =========================================================
 * NORMALIZAR EMAIL
 * =========================================================
 */

function normalizeEmail(email) {

  return String(
    email || ""
  )
    .trim()
    .toLowerCase();

}


/*
 * =========================================================
 * GERAR HASH DA SENHA
 * =========================================================
 *
 * Formato armazenado:
 *
 * scrypt$N$r$p$salt$hash
 *
 * O hash contém:
 *
 * - algoritmo
 * - parâmetros
 * - salt
 * - hash
 *
 * =========================================================
 */

function hashPassword(password) {

  const salt =
    crypto.randomBytes(16);

  const N = 16384;
  const r = 8;
  const p = 1;

  const key =
    crypto.scryptSync(
      password,
      salt,
      64,
      {
        N,
        r,
        p,
        maxmem:
          32 * 1024 * 1024
      }
    );

  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("hex"),
    key.toString("hex")
  ].join("$");

}


/*
 * =========================================================
 * VERIFICAR HASH
 * =========================================================
 */

function verifyPassword(
  password,
  storedHash
) {

  try {

    const parts =
      String(
        storedHash || ""
      ).split("$");


    if (
      parts.length !== 6
    ) {
      return false;
    }


    const [
      algorithm,
      NText,
      rText,
      pText,
      saltHex,
      hashHex
    ] = parts;


    if (
      algorithm !== "scrypt"
    ) {
      return false;
    }


    const N =
      Number(NText);

    const r =
      Number(rText);

    const p =
      Number(pText);


    if (
      !Number.isInteger(N) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p)
    ) {
      return false;
    }


    const salt =
      Buffer.from(
        saltHex,
        "hex"
      );

    const originalHash =
      Buffer.from(
        hashHex,
        "hex"
      );


    if (
      salt.length < 16 ||
      originalHash.length !== 64
    ) {
      return false;
    }


    const calculatedHash =
      crypto.scryptSync(
        password,
        salt,
        originalHash.length,
        {
          N,
          r,
          p,
          maxmem:
            32 * 1024 * 1024
        }
      );


    return crypto.timingSafeEqual(
      calculatedHash,
      originalHash
    );

  } catch {

    return false;

  }

}


/*
 * =========================================================
 * GERAR ID DE SESSÃO
 * =========================================================
 *
 * A sessão é um token aleatório.
 *
 * NÃO usamos email.
 * NÃO usamos senha.
 * NÃO usamos ID previsível.
 *
 * =========================================================
 */

function generateSessionToken() {

  return crypto
    .randomBytes(32)
    .toString("hex");

}


/*
 * =========================================================
 * COOKIE
 * =========================================================
 *
 * HttpOnly:
 * JavaScript do navegador não consegue ler o cookie.
 *
 * Secure:
 * enviado somente por HTTPS.
 *
 * SameSite=Strict:
 * reduz risco de CSRF.
 *
 * =========================================================
 */

function buildSessionCookie(
  token
) {

  return [
    `${SESSION_COOKIE}=${token}`,

    `Max-Age=${SESSION_MAX_AGE}`,

    "Path=/",

    "HttpOnly",

    "Secure",

    "SameSite=Strict"
  ].join("; ");

}


/*
 * =========================================================
 * HANDLER
 * =========================================================
 */

export default async function handler(
  req,
  res
) {

  /*
   * -------------------------------------------------------
   * MÉTODO
   * -------------------------------------------------------
   */

  if (
    req.method !== "POST"
  ) {

    res.setHeader(
      "Allow",
      "POST"
    );

    return json(
      res,
      405,
      {
        success: false,
        error:
          "Método não permitido."
      }
    );

  }


  try {

    /*
     * -----------------------------------------------------
     * DATABASE
     * -----------------------------------------------------
     */

    if (
      !process.env.DATABASE_URL
    ) {

      return json(
        res,
        500,
        {
          success: false,
          error:
            "DATABASE_URL não configurada."
        }
      );

    }


    const sql =
      neon(
        process.env.DATABASE_URL
      );


    /*
     * -----------------------------------------------------
     * BODY
     * -----------------------------------------------------
     */

    const body =
      req.body || {};


    const email =
      normalizeEmail(
        body.email
      );


    const password =
      String(
        body.password || ""
      );


    /*
     * -----------------------------------------------------
     * VALIDAÇÃO
     * -----------------------------------------------------
     */

    if (
      !email ||
      !password
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Email e senha são obrigatórios."
        }
      );

    }


    if (
      email.length > 254
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Email inválido."
        }
      );

    }


    if (
      password.length > 200
    ) {

      return json(
        res,
        400,
        {
          success: false,
          error:
            "Senha inválida."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * PROCURAR ADMIN
     * -----------------------------------------------------
     */

    const admins =
      await sql`

        SELECT

          id,
          email,
          password_hash,
          active

        FROM admin_users

        WHERE email =
          ${email}

        LIMIT 1

      `;


    /*
     * -----------------------------------------------------
     * RESPOSTA GENÉRICA
     * -----------------------------------------------------
     *
     * Não informamos se o email existe.
     *
     * Isso evita facilitar enumeração de contas.
     * -----------------------------------------------------
     */

    if (
      admins.length === 0
    ) {

      return json(
        res,
        401,
        {
          success: false,
          error:
            "Email ou senha incorretos."
        }
      );

    }


    const admin =
      admins[0];


    /*
     * -----------------------------------------------------
     * ADMIN ATIVO
     * -----------------------------------------------------
     */

    if (
      admin.active !== true
    ) {

      return json(
        res,
        403,
        {
          success: false,
          error:
            "A conta administrativa está desativada."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * VERIFICAR SENHA
     * -----------------------------------------------------
     */

    const passwordValid =
      verifyPassword(
        password,
        admin.password_hash
      );


    if (
      !passwordValid
    ) {

      return json(
        res,
        401,
        {
          success: false,
          error:
            "Email ou senha incorretos."
        }
      );

    }


    /*
     * -----------------------------------------------------
     * GERAR SESSÃO
     * -----------------------------------------------------
     */

    const sessionToken =
      generateSessionToken();


    /*
     * -----------------------------------------------------
     * COOKIE
     * -----------------------------------------------------
     */

    const cookie =
      buildSessionCookie(
        sessionToken
      );


    res.setHeader(
      "Set-Cookie",
      cookie
    );


    /*
     * -----------------------------------------------------
     * LOGIN CONCLUÍDO
     * -----------------------------------------------------
     *
     * O token NÃO é devolvido no JSON.
     *
     * Ele fica somente no cookie HTTP-only.
     * -----------------------------------------------------
     */

    return json(
      res,
      200,
      {

        success: true,

        message:
          "Login administrativo realizado com sucesso.",

        admin: {

          id:
            admin.id,

          email:
            admin.email

        }

      }
    );


  } catch (error) {

    console.error(
      "USDTMZ ADMIN LOGIN ERROR:",
      error?.message ||
      error
    );


    return json(
      res,
      500,
      {
        success: false,
        error:
          "Erro interno ao realizar login."
      }
    );

  }

}
