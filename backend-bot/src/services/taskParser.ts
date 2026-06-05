import type { ParsedTask, Priority } from "../types.js";

const priorityWords: Array<[RegExp, Priority]> = [
  [/(критично|срочно|горит|asap)/i, "CRITICAL"],
  [/(важно|высок)/i, "HIGH"],
  [/(низк|не срочно)/i, "LOW"],
];

export class TaskParser {
  parse(text: string): ParsedTask {
    const assigneeUsername = text.match(/@([a-zA-Z0-9_]{3,})/)?.[1];
    const deadlineAt = this.parseDeadline(text);
    const priority = this.parsePriority(text);
    const title = this.cleanTitle(text, assigneeUsername);

    return {
      title: title || "Новая задача",
      assigneeUsername,
      deadlineAt,
      priority,
      description: text.trim(),
    };
  }

  private parsePriority(text: string): Priority {
    for (const [pattern, priority] of priorityWords) {
      if (pattern.test(text)) return priority;
    }
    return "MEDIUM";
  }

  private parseDeadline(text: string) {
    const lower = text.toLowerCase();
    const now = new Date();
    const explicitDateTime = lower.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s+(\d{1,2})[:.](\d{2})/);
    if (explicitDateTime) {
      const year = explicitDateTime[3] ? normalizeYear(Number(explicitDateTime[3])) : now.getFullYear();
      const date = new Date(
        year,
        Number(explicitDateTime[2]) - 1,
        Number(explicitDateTime[1]),
        Number(explicitDateTime[4]),
        Number(explicitDateTime[5]),
        0,
        0,
      );
      return date.toISOString();
    }

    const timeMatch = lower.match(/(?:до|в|к)\s+(\d{1,2})[:.](\d{2})/);
    const hours = timeMatch ? Number(timeMatch[1]) : 12;
    const minutes = timeMatch ? Number(timeMatch[2]) : 0;

    if (lower.includes("завтра")) {
      const date = new Date(now);
      date.setDate(date.getDate() + 1);
      date.setHours(hours, minutes, 0, 0);
      return date.toISOString();
    }

    const inDays = lower.match(/через\s+(\d+)\s+д/);
    if (inDays) {
      const date = new Date(now);
      date.setDate(date.getDate() + Number(inDays[1]));
      date.setHours(hours, minutes, 0, 0);
      return date.toISOString();
    }

    const dateMatch = lower.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
    if (dateMatch) {
      const year = dateMatch[3] ? normalizeYear(Number(dateMatch[3])) : now.getFullYear();
      const date = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]), hours, minutes, 0, 0);
      return date.toISOString();
    }

    return undefined;
  }

  private cleanTitle(text: string, assigneeUsername?: string) {
    let result = text
      .replace(/^\/new\s*/i, "")
      .replace(/^(создай|поставь|добавь|назначь)\s+(задачу\s+)?/i, "")
      .replace(/(срочно|критично|важно|не срочно|asap)/gi, "")
      .replace(/до\s+\d{1,2}[:.]\d{2}/gi, "")
      .replace(/через\s+\d+\s+д\w*/gi, "")
      .replace(/\d{1,2}[./]\d{1,2}([./]\d{2,4})?/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (assigneeUsername) result = result.replace(`@${assigneeUsername}`, "").trim();
    return result;
  }
}

function normalizeYear(year: number) {
  if (year < 100) return 2000 + year;
  return year;
}
