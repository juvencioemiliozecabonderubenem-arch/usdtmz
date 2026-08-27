import { createHmac, timingSafeEqual } from "node:crypto";

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  const cookies = cookieHeader
    .split(";")
    .map(cookie => cookie.trim());

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) continue;

    const key = cookie
      .slice(0, separator)
      .trim();

    const value = cookie
      .slice(separator + 1)
      .trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

function verifySession(token, secret) {
  try {
    if (!token || !secret) {
      return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const encoded = parts[0];
    const receivedSignature = parts[1];

    const expectedSignature =
      createHmac(
        "sha256",
        secret
      )
        .update(encoded)
        .digest("base64url");

    const receivedBuffer =
      Buffer.from(
        receivedSignature,
        "utf8"
      );

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "utf8"
      );

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {
      return null;
    }

    if (
      !timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      )
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        Buffer.from(
          encoded,
          "base64url"
        ).toString("utf8")
      );

    if (
      !payload ||
      !payload.id ||
      !payload.email ||
      !payload.exp
    ) {
      return null;
    }

    if (
      Date.now() >=
      Number(payload.exp)
    ) {
      return null;
    }

    return payload;

  } catch (error) {

    console.error(
      "SESSION VERIFY ERROR:",
      error
    );

    return null;
  }
}

export default async function handler(req, res) {

  if (req.method !== "GET") {

    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });

  }

  const secret =
    process.env.ADMIN_SESSION_SECRET;

  if (!secret) {

    return json(res, 500, {
      success: false,
      error:
        "ADMIN_SESSION_SECRET não configurada."
    });

  }

  const token =
    getCookie(
      req,
      "usdtmz_admin_session"
    );

  if (!token) {

    return json(res, 200, {
      success: true,
      authenticated: false
    });

  }

  const session =
    verifySession(
      token,
      secret
    );

  if (!session) {

    return json(res, 200, {
      success: true,
      authenticated: false
    });

  }

  return json(res, 200, {

    success: true,

    authenticated: true,

    admin: {
      id: session.id,
      email: session.email
    }

  });

}
