export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();

    res.status(200).json({
      ip: data.ip
    });
  } catch (error) {
    res.status(500).json({
      error: "Não foi possível obter o IP"
    });
  }
}
