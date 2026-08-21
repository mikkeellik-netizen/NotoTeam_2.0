import type { ParsedTask, Priority } from "../types.js";
import { parseDateTime, stripDateTimePhrases } from "./dateParser.js";

const priorityWords: Array<[RegExp, Priority]> = [
  [/(критично|срочно|горит|asap|critical|urgent)/i, "CRITICAL"],
  [/(важно|высок(?:ий|ая|ое|о)?|high)/i, "HIGH"],
  [/(низк(?:ий|ая|ое|о)?|не срочно|low)/i, "LOW"],
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
    const date = parseDateTime(text, { defaultHour: 12 });
    return date ? date.toISOString() : undefined;
  }

  private cleanTitle(text: string, assigneeUsername?: string) {
    let result = stripDateTimePhrases(text)
      .replace(/^\/(?:new|task)\s*/i, "")
      .replace(/^(создай|создать|поставь|добавь|назначь)\s+(задачу\s+)?/i, "")
      .replace(/\b(срочно|критично|важно|не срочно|asap|critical|urgent|high|low)\b/gi, "")
      .replace(/\b(должен|должна|должны|надо|нужно)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (assigneeUsername) {
      result = result.replace(new RegExp(`@${escapeRegExp(assigneeUsername)}`, "i"), "").trim();
    }
    return result;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
