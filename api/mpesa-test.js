export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "M-Pesa Testing",
    message: "Endpoint USDTMZ criado com sucesso"
  });
}
