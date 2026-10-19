const express = require("express");
const { createClient } = require("redis");

// Настройки берём из переменных окружения (их будет задавать docker-compose)
const PORT = Number(process.env.PORT) || 3000;
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
// Пароль от Redis (если не задан, клиент подключается без пароля)
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const MESSAGES_KEY = "messages";
const VISITS_KEY = "visits";
const MAX_MESSAGES = 50;

const redis = createClient({
  socket: { host: REDIS_HOST, port: REDIS_PORT },
  password: REDIS_PASSWORD,
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

// Статистика: только чтение, без побочных эффектов
// (GET не должен менять данные: иначе счётчик растёт от ботов, проверок и curl)
app.get(
  "/stats",
  wrap(async (req, res) => {
    const [visits, messages] = await Promise.all([
      redis.get(VISITS_KEY),
      redis.lLen(MESSAGES_KEY),
    ]);
    res.json({ visits: Number(visits) || 0, messages });
  })
);

// Засчитать посещение: фронтенд вызывает один раз за сессию вкладки
app.post(
  "/visit",
  wrap(async (req, res) => {
    const visits = await redis.incr(VISITS_KEY);
    res.json({ visits });
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

/* ---------- Корректная остановка ---------- */

let server;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен ${signal}, завершаю работу...`);

  // Страховка: Docker через 10 секунд после SIGTERM пришлёт SIGKILL,
  // поэтому выходим сами раньше, если что-то зависло
  setTimeout(() => {
    console.error("Не успели завершиться вовремя, выхожу принудительно");
    process.exit(1);
  }, 8000).unref();

  try {
    if (server) {
      // перестать принимать новые соединения и дождаться текущих запросов
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections(); // не ждать «спящие» keep-alive соединения
      });
    }
    if (redis.isOpen) await redis.quit(); // дождаться выполнения команд и закрыть соединение
    console.log("Остановлен корректно");
    process.exit(0);
  } catch (err) {
    console.error("Ошибка при остановке:", err.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM")); // docker stop / docker compose down
process.on("SIGINT", () => shutdown("SIGINT")); // Ctrl+C

(async () => {
  // connect() сам повторяет попытки, пока Redis не поднимется
  await redis.connect();
  console.log(`Подключено к Redis ${REDIS_HOST}:${REDIS_PORT}`);
  server = app.listen(PORT, "0.0.0.0", () => console.log(`API слушает порт ${PORT}`));
})();