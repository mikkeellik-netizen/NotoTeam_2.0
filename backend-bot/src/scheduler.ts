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
      const settings = project.botSettings;
      let changed = false;

      // Надёжная логика: сегодня нужный день недели, время УЖЕ наступило и сегодня ещё не слали.
      // Это переживает дрейф таймера и моменты пробуждения на бесплатном хостинге.
      if (isReportDue(settings.reports.weekly, current)) {
        await this.reports.sendWeeklyReport(project);
        settings.reports.weekly.lastSentDate = current.date;
        changed = true;
      }

      if (isReportDue(settings.reports.overdue, current)) {
        await this.reports.sendOverdueReport(project);
        settings.reports.overdue.lastSentDate = current.date;
        changed = true;
      }

      if (changed) {
        await this.repo.updateProjectBotSettings(project.id, settings).catch((error) =>
          console.error("Failed to persist report lastSentDate", error instanceof Error ? error.message : error),
        );
      }
    }
  }
}

function isReportDue(
  report: { enabled: boolean; weekdays: number[]; time: string; lastSentDate?: string },
  current: { weekday: number; minutesOfDay: number; date: string },
) {
  if (!report.enabled) return false;
  if (!report.weekdays.includes(current.weekday)) return false;
  if (report.lastSentDate === current.date) return false; // уже отправляли сегодня
  const scheduled = parseMinutes(report.time);
  return current.minutesOfDay >= scheduled;
}

function parseMinutes(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getMskTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string, fallback: string) => parts.find((part) => part.type === type)?.value ?? fallback;
  const weekdayText = get("weekday", "Mon");
  const hour = get("hour", "00");
  const minute = get("minute", "00");
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
    minutesOfDay: Number(hour) * 60 + Number(minute),
    date: `${get("year", "1970")}-${get("month", "01")}-${get("day", "01")}`,
  };
}
