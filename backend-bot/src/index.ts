import http from "node:http";
import { webhookCallback } from "grammy";
import { loadConfig } from "./config.js";
import { HttpWorkspaceRepository } from "./storage/httpRepository.js";
import { GrammyMessenger } from "./telegram/messenger.js";
import { TelegramWorkspaceBot } from "./telegram/botApp.js";
import { NotificationService } from "./services/notificationService.js";
import { ReportService } from "./services/reportService.js";
import { BotScheduler } from "./scheduler.js";

// Держит бесплатный Render-инстанс "тёплым": сам себя пингует раз в 10 минут,
// не давая усыпить процесс после 15 минут простоя. Не гарантия на 100% (при
// перезапуске/деплое пинг всё равно временно прервётся), но резко снижает
// шанс, что бот "спит" в момент, когда пользователь пишет команду.
function startSelfPing(publicUrl: string) {
  setInterval(() => {
    fetch(publicUrl).catch(() => undefined);
  }, 10 * 60 * 1000);
}

async function main() {
  const config = loadConfig();
  const repo = new HttpWorkspaceRepository(config.workspaceApiUrl, config.internalApiToken);
  const bot = new TelegramWorkspaceBot(config, repo);
  const messenger = new GrammyMessenger(bot.instance);
  const notifications = new NotificationService(repo, messenger, config.webAppUrl);
  const reports = new ReportService(repo, messenger);
  bot.setNotificationService(notifications);
  const scheduler = new BotScheduler(repo, notifications, reports, messenger);

  scheduler.start();

  const port = Number(process.env.PORT) || 3000;

  if (config.mode === "webhook" && config.publicUrl) {
    // Единый HTTP-сервер: health-check для PaaS + приём апдейтов от Telegram.
    // Входящее сообщение от Telegram само по себе — HTTP-запрос, поэтому такой
    // режим переживает усыпление бесплатных хостингов (в отличие от long polling,
    // которому нужно постоянно открытое соединение).
    const secretToken = config.internalApiToken.slice(0, 32);
    const handleWebhook = webhookCallback(bot.instance, "http", { secretToken });

    http
      .createServer((req, res) => {
        if (req.url === config.webhookPath && req.method === "POST") {
          void handleWebhook(req, res);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "telegram-workspace-bot", mode: "webhook" }));
      })
      .listen(port, () => {
        console.log(`HTTP server listening on port ${port}`);
      });

    await bot.startWebhook(config.publicUrl, config.webhookPath, secretToken);
    startSelfPing(config.publicUrl);
    return;
  }

  // Локальная разработка / хостинг без sleep — обычный long polling.
  http
    .createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "telegram-workspace-bot", mode: "polling" }));
    })
    .listen(port, () => {
      console.log(`Health check server listening on port ${port}`);
    });

  await bot.start();
}

// Не даём одиночным сбоям сети/тиков уронить процесс бота
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error instanceof Error ? error.message : error);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
