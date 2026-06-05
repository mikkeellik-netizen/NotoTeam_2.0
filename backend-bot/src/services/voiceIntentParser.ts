import { TaskParser } from "./taskParser.js";
import type { ParsedTask, ReminderRecurrence } from "../types.js";

export type VoiceIntent =
  | {
      kind: "task";
      originalText: string;
      parsedTask: ParsedTask;
    }
  | {
      kind: "reminder";
      originalText: string;
      title: string;
      description?: string;
      remindAt?: string;
      recurrence?: ReminderRecurrence;
      scheduleType: "once" | "recurring";
      assigneeUsername?: string;
    }
  | {
      kind: "notification";
      originalText: string;
      title: string;
      description?: string;
      assigneeUsername?: string;
    }
  | {
      kind: "note";
      originalText: string;
      title: string;
      text: string;
    };

export class VoiceIntentParser {
  constructor(private taskParser = new TaskParser()) {}

  parse(text: string): VoiceIntent {
    const normalized = text.trim();
    const lower = normalized.toLowerCase();
    const taskLike = this.taskParser.parse(normalized);

    if (/(заметка|запиши|сохрани мысль|идея|note)/i.test(lower)) {
      return {
        kind: "note",
        originalText: normalized,
        title: cleanLead(normalized, /(заметка|запиши|сохрани мысль|идея|note)/i) || "Голосовая заметка",
        text: normalized,
      };
    }

    if (/(напомни|напоминание|напомнить|remind)/i.test(lower)) {
      return {
        kind: "reminder",
        originalText: normalized,
        title: cleanLead(taskLike.title, /(напомни|напоминание|напомнить|remind)/i) || taskLike.title,
        description: normalized,
        remindAt: taskLike.deadlineAt,
        scheduleType: "once",
        assigneeUsername: taskLike.assigneeUsername,
      };
    }

    if (/(уведоми|уведомление|сообщи|notification)/i.test(lower)) {
      return {
        kind: "notification",
        originalText: normalized,
        title: cleanLead(taskLike.title, /(уведоми|уведомление|сообщи|notification)/i) || taskLike.title,
        description: normalized,
        assigneeUsername: taskLike.assigneeUsername,
      };
    }

    return {
      kind: "task",
      originalText: normalized,
      parsedTask: taskLike,
    };
  }
}

export function voiceIntentLabel(intent: VoiceIntent) {
  if (intent.kind === "task") return "задача";
  if (intent.kind === "reminder") return "напоминание";
  if (intent.kind === "notification") return "уведомление";
  return "заметка";
}

function cleanLead(text: string, pattern: RegExp) {
  return text.replace(pattern, "").replace(/\s+/g, " ").trim();
}
