import type { BotMessenger, WorkspaceRepository } from "./ports.js";
import { NotificationService } from "./services/notificationService.js";
import { ReportService } from "./services/reportService.js";

export class BotScheduler {
  private notificationTimer?: NodeJS.Timeout;
  private reportTimer?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;
  private outboxTimer?: NodeJS.Timeout;

  constructor(
    private repo: WorkspaceRepository,
    private notifications: NotificationService,
    private reports: ReportService,
    private messenger?: BotMessenger,
  ) {}

  // Запускает задачу, не давая ошибке уронить весь процесс бота.
  private safe(label: string, run: () => Promise<unknown>) {
    Promise.resolve()
      .then(run)
      .catch((error) => console.error(`${label} failed`, error instanceof Error ? error.message : error));
  }

  start() {
    this.notificationTimer = setInterval(() => {
      this.safe("deliverDueNotifications", () => this.notifications.deliverDueNotifications());
      this.safe("deliverDueReminders", () => this.notifications.deliverDueReminders());
    }, 60_000);

    // Доставка кодов входа и прочих служебных сообщений — раз в 5 секунд
    this.outboxTimer = setInterval(() => {
      this.safe("outbox", () => this.runOutboxTick());
    }, 5_000);

    this.reportTimer = setInterval(() => {
      this.safe("report", () => this.runReportTick());
    }, 60_000);

    this.syncTimer = setInterval(() => {
      this.safe("sync", () => this.runSyncTick());
    }, 5 * 60_000);

    this.safe("deliverDueNotifications", () => this.notifications.deliverDueNotifications());
    this.safe("deliverDueReminders", () => this.notifications.deliverDueReminders());
    this.safe("report", () => this.runReportTick());
    this.safe("sync", () => this.runSyncTick());
    this.safe("outbox", () => this.runOutboxTick());
  }

  stop() {
    if (this.notificationTimer) clearInterval(this.notificationTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.outboxTimer) clearInterval(this.outboxTimer);
  }

  private async runOutboxTick() {
    if (!this.messenger) return;
    try {
      const messages = await this.repo.fetchPendingOutbox();
      for (const message of messages) {
        try {
          await this.messenger.sendMessage(message.telegramId, message.text);
        } catch (error) {
          console.error("Outbox send failed", error instanceof Error ? error.message : error);
        } finally {
          await this.repo.markOutboxSent(message.id);
        }
      }
    } catch (error) {
      console.error("Outbox tick failed", error instanceof Error ? error.message : error);
    }
  }

  private async runSyncTick() {
    const projects = await this.repo.listProjects();
    for (const project of projects) {
      await this.notifications.syncProjectNotifications(project.id);
    }
  }

  private async runReportTick() {
    const now = new Date();
    const current = getMskTimeParts(now);
    const projects = await this.repo.listProjects();

    for (const project of projects) {
      const weekly = project.botSettings.reports.weekly;
      if (weekly.enabled && weekly.weekdays.includes(current.weekday) && weekly.time === current.time) {
        await this.reports.sendWeeklyReport(project);
      }

      const overdue = project.botSettings.reports.overdue;
      if (overdue.enabled && overdue.weekdays.includes(current.weekday) && overdue.time === current.time) {
        await this.reports.sendOverdueReport(project);
      }
    }
  }
}

function getMskTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekdayText = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 0,
  };

  return {
    weekday: weekdayMap[weekdayText] ?? 1,
    time: `${hour}:${minute}`,
  };
}
