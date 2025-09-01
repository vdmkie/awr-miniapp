const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Статика (frontend)
app.use(express.static(path.join(__dirname, "../frontend")));

// Пример API
app.get("/api/ping", (req, res) => {
  res.json({ message: "pong" });
});

// Все остальные запросы → index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Запуск сервера
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ WebApp running on port ${PORT}`);
});
