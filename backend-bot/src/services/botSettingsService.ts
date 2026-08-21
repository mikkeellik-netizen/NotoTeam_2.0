import type { WorkspaceRepository } from "../ports.js";
import type { BotReportSettings, ProjectBotSettings } from "../types.js";
import { mergeBotSettings } from "../defaultSettings.js";

export class BotSettingsService {
  constructor(private repo: WorkspaceRepository) {}

  async getSettings(projectId: string) {
    const project = await this.repo.getProject(projectId);
    if (!project) throw new Error("Project not found");
    return mergeBotSettings(project.botSettings);
  }

  async updateSettings(projectId: string, patch: Partial<ProjectBotSettings>) {
    const current = await this.getSettings(projectId);
    const next: ProjectBotSettings = {
      ...current,
      ...patch,
      reports: {
        weekly: patch.reports?.weekly ? mergeReport(current.reports.weekly, patch.reports.weekly) : current.reports.weekly,
        overdue: patch.reports?.overdue ? mergeReport(current.reports.overdue, patch.reports.overdue) : current.reports.overdue,
      },
      kanbanReminderPoints: patch.kanbanReminderPoints ?? current.kanbanReminderPoints,
    };

    return this.repo.updateProjectBotSettings(projectId, next);
  }

  async setReportsEnabled(projectId: string, input: { weekly?: boolean; overdue?: boolean }) {
    const current = await this.getSettings(projectId);
    return this.updateSettings(projectId, {
      reports: {
        weekly: { ...current.reports.weekly, enabled: input.weekly ?? current.reports.weekly.enabled },
        overdue: { ...current.reports.overdue, enabled: input.overdue ?? current.reports.overdue.enabled },
      },
    });
  }

  async setKanbanReminderPointEnabled(projectId: string, reminderId: string, enabled: boolean) {
    const current = await this.getSettings(projectId);
    return this.updateSettings(projectId, {
      kanbanReminderPoints: current.kanbanReminderPoints.map((point) =>
        point.id === reminderId ? { ...point, enabled } : point,
      ),
    });
  }

  async addKanbanReminder(projectId: string, input: { label: string; offsetMinutes: number }) {
    const current = await this.getSettings(projectId);
    return this.updateSettings(projectId, {
      kanbanReminderPoints: [
        ...current.kanbanReminderPoints,
        {
          id: `before_${input.offsetMinutes}_${Date.now()}`,
          enabled: true,
          kind: "before_deadline",
          offsetMinutes: input.offsetMinutes,
          label: input.label,
        },
      ],
    });
  }

  async removeKanbanReminder(projectId: string, reminderId: string) {
    const current = await this.getSettings(projectId);
    return this.updateSettings(projectId, {
      kanbanReminderPoints: current.kanbanReminderPoints.filter((point) => point.id !== reminderId),
    });
  }
}

function mergeReport(current: BotReportSettings, patch: Partial<BotReportSettings>): BotReportSettings {
  return {
    ...current,
    ...patch,
    sections: {
      ...current.sections,
      ...patch.sections,
    },
  };
}
