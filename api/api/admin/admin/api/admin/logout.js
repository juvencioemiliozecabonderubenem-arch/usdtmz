function json(res, status, data) {

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(status).json(data);
}

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return json(res, 405, {
      success: false,
      error: "Método não permitido."
    });

  }

  res.setHeader(
    "Set-Cookie",
    "usdtmz_admin_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0; Secure"
  );

  return json(res, 200, {
    success: true,
    message: "Sessão encerrada."
  });

}
