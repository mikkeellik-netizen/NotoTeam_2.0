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

const NOTE_PATTERN = /(?:запиши(?:\s+заметку)?|сохрани мысль|заметка|идея|note)/i;
const REMINDER_PATTERN = /(напомни|напоминание|напомнить|remind)/i;
const NOTIFICATION_PATTERN = /(уведоми|уведомление|сообщи|notification)/i;

export class VoiceIntentParser {
  constructor(private taskParser = new TaskParser()) {}

  parse(text: string): VoiceIntent {
    const normalized = text.trim();
    const taskLike = this.taskParser.parse(normalized);

    if (NOTE_PATTERN.test(normalized)) {
      return {
        kind: "note",
        originalText: normalized,
        title: cleanLead(normalized, NOTE_PATTERN) || "Голосовая заметка",
        text: normalized,
      };
    }

    if (REMINDER_PATTERN.test(normalized)) {
      return {
        kind: "reminder",
        originalText: normalized,
        title: cleanLead(taskLike.title, REMINDER_PATTERN) || taskLike.title,
        description: normalized,
        remindAt: taskLike.deadlineAt,
        scheduleType: "once",
        assigneeUsername: taskLike.assigneeUsername,
      };
    }

    if (NOTIFICATION_PATTERN.test(normalized)) {
      return {
        kind: "notification",
        originalText: normalized,
        title: cleanLead(taskLike.title, NOTIFICATION_PATTERN) || taskLike.title,
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
