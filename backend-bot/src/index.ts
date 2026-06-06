import { loadConfig } from "./config.js";
import { HttpWorkspaceRepository } from "./storage/httpRepository.js";
import { GrammyMessenger } from "./telegram/messenger.js";
import { TelegramWorkspaceBot } from "./telegram/botApp.js";
import { NotificationService } from "./services/notificationService.js";
import { ReportService } from "./services/reportService.js";
import { BotScheduler } from "./scheduler.js";

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
