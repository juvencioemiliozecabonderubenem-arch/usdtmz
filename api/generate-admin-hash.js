import crypto from "node:crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  const password = String(req.body?.password || "");

  if (!password) {
    return res.status(400).json({
      success: false,
      error: "Informe a senha."
    });
  }

  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);

  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      64,
      {
        N,
        r,
        p,
        maxmem: 32 * 1024 * 1024
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });

  const hash = [
    "scrypt",
    N,
    r,
    p,
    salt.toString("hex"),
    derivedKey.toString("hex")
  ].join("$");

  return res.status(200).json({
    success: true,
    hash
  });
}
