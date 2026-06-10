import type { ParsedTask, Priority } from "../types.js";
import { parseDateTime } from "./dateParser.js";

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
    // Единый парсер: DD.MM.YYYY / DD.MM.YY / DD.MM, время HH:MI,
    // а также завтра/послезавтра/через N дней/сегодня. Для задач час по умолчанию — 12:00.
    const date = parseDateTime(text, { defaultHour: 12 });
    return date ? date.toISOString() : undefined;
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
