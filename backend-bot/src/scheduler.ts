import type { WorkspaceRepository } from "./ports.js";
import { NotificationService } from "./services/notificationService.js";
import { ReportService } from "./services/reportService.js";

export class BotScheduler {
  private notificationTimer?: NodeJS.Timeout;
  private reportTimer?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;

  constructor(
    private repo: WorkspaceRepository,
    private notifications: NotificationService,
    private reports: ReportService,
  ) {}

  start() {
    this.notificationTimer = setInterval(() => {
      void this.notifications.deliverDueNotifications();
      void this.notifications.deliverDueReminders();
    }, 60_000);

    this.reportTimer = setInterval(() => {
      void this.runReportTick();
    }, 60_000);

    this.syncTimer = setInterval(() => {
      void this.runSyncTick();
    }, 5 * 60_000);

    void this.notifications.deliverDueNotifications();
    void this.notifications.deliverDueReminders();
    void this.runReportTick();
    void this.runSyncTick();
  }

  stop() {
    if (this.notificationTimer) clearInterval(this.notificationTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
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
