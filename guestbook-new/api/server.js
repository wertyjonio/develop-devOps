const express = require("express");
const { createClient } = require("redis");

// Настройки берём из переменных окружения (их будет задавать docker-compose)
const PORT = Number(process.env.PORT) || 3000;
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const MESSAGES_KEY = "messages";
const MAX_MESSAGES = 50;

const redis = createClient({
  socket: { host: REDIS_HOST, port: REDIS_PORT },
  // если Redis недоступен, команды сразу падают с ошибкой, а не висят в очереди
  disableOfflineQueue: true,
});
redis.on("error", (err) => console.error("Redis error:", err.message));

const app = express();
app.use(express.json({ limit: "10kb" }));

// Обёртка, чтобы ошибки async-обработчиков попадали в общий обработчик ошибок
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok", redis: "up" });
  } catch {
    res.status(503).json({ status: "error", redis: "down" });
  }
});

// Счётчик визитов + количество сообщений
app.get(
  "/stats",
  wrap(async (req, res) => {
    const visits = await redis.incr("visits");
    const messages = await redis.lLen(MESSAGES_KEY);
    res.json({ visits, messages });
  })
);

// Последние сообщения (новые первыми)
app.get(
  "/messages",
  wrap(async (req, res) => {
    const items = await redis.lRange(MESSAGES_KEY, 0, MAX_MESSAGES - 1);
    res.json(items.map((item) => JSON.parse(item)));
  })
);

app.post(
  "/messages",
  wrap(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const text = String(req.body?.text ?? "").trim();

    if (!name || !text) {
      return res.status(400).json({ error: "name and text are required" });
    }
    if (name.length > 30 || text.length > 300) {
      return res.status(400).json({ error: "name max 30, text max 300 chars" });
    }

    const message = { name, text, createdAt: new Date().toISOString() };
    await redis.lPush(MESSAGES_KEY, JSON.stringify(message));
    await redis.lTrim(MESSAGES_KEY, 0, MAX_MESSAGES - 1); // храним только последние 50
    res.status(201).json(message);
  })
);

app.use((req, res) => res.status(404).json({ error: "not found" }));

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: "internal error" });
});

(async () => {
  // connect() сам повторяет попытки, пока Redis не поднимется
  await redis.connect();
  console.log(`Подключено к Redis ${REDIS_HOST}:${REDIS_PORT}`);
  app.listen(PORT, "0.0.0.0", () => console.log(`API слушает порт ${PORT}`));
})();
