import sql from "./db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido."
    });
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(120) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        operation VARCHAR(10) NOT NULL,
        amount NUMERIC(30, 8) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    return res.status(200).json({
      success: true,
      message: "Banco de dados inicializado."
    });

  } catch (error) {
    console.error("Database initialization error:", error);

    return res.status(500).json({
      success: false,
      message: "Não foi possível inicializar o banco."
    });
  }
}
