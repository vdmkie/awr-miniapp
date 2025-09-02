import express from "express";
import sqlite3 from "sqlite3";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";

const app = express();
const PORT = process.env.PORT || 8080;

// Подключение к базе SQLite
const db = new sqlite3.Database("./awr.db");

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), "../frontend")));

// Endpoint авторизации
app.post("/auth", (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: "Номер телефона не указан" });
  }

  // Приводим номер к формату +380XXXXXXXXX
  const phone = phone_number.replace(/\D/g, ""); // оставляем только цифры
  const formattedPhone = `+${phone}`;

  db.get(
    "SELECT id, name, role FROM users WHERE phone = ?",
    [formattedPhone],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(401).json({ error: "Пользователь не найден" });

      // Авторизация успешна
      return res.json({
        id: row.id,
        name: row.name,
        role: row.role,
      });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Backend запущен на http://localhost:${PORT}`);
});
