import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

const COOKIE_NAME = "usdtmz_admin_session";

function json(res, status, data) {
  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}

function getBody(req) {

  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

function safeCompare(a, b) {

  const first = Buffer.from(
    String(a),
    "utf8"
  );

  const second = Buffer.from(
    String(b),
    "utf8"
  );

  if (first.length !== second.length) {
    return false;
  }

  return timingSafeEqual(
    first,
    second
  );
}

export default async function handler(req, res) {

  if (req.method !== "POST") {

    res.setHeader(
      "Allow",
      "POST"
    );

    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });
  }

  const adminEmail =
    process.env.ADMIN_EMAIL;

  const adminPassword =
    process.env.ADMIN_PASSWORD;

  const sessionSecret =
    process.env.ADMIN_SESSION_SECRET;

  if (
    !adminEmail ||
    !adminPassword ||
    !sessionSecret
  ) {

    console.error(
      "Variáveis de administração não configuradas."
    );

    return json(res, 500, {
      success: false,
      error:
        "Configuração administrativa incompleta."
    });
  }

  const body = getBody(req);

  const email =
    String(body.email || "")
      .trim()
      .toLowerCase();

  const password =
    String(body.password || "");

  if (!email || !password) {

    return json(res, 400, {
      success: false,
      error:
        "Email e senha são obrigatórios."
    });
  }

  const emailOk =
    safeCompare(
      email,
      String(adminEmail)
        .trim()
        .toLowerCase()
    );

  const passwordOk =
    safeCompare(
      password,
      String(adminPassword)
    );

  if (!emailOk || !passwordOk) {

    return json(res, 401, {
      success: false,
      error:
        "Email ou senha incorretos."
    });
  }

  // Sessão válida por 12 horas
  const expiresAt =
    Date.now() +
    (12 * 60 * 60 * 1000);

  const payload = {
    id: "admin",
    email,
    exp: expiresAt
  };

  const encoded =
    Buffer.from(
      JSON.stringify(payload),
      "utf8"
    ).toString("base64url");

  const signature =
    createHmac(
      "sha256",
      sessionSecret
    )
      .update(encoded)
      .digest("base64url");

  const token =
    `${encoded}.${signature}`;

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`
  );

  return json(res, 200, {
    success: true,
    message: "Login realizado."
  });
}
