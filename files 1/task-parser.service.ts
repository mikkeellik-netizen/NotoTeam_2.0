import { Injectable } from '@nestjs/common';
import { addDays, setHours, setMinutes, nextDay, startOfDay } from 'date-fns';

export interface ParsedTask {
  title?: string;
  assigneeHint?: string;   // имя из текста, не ID
  deadlineAt?: Date;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  missing: ('title' | 'assignee' | 'deadline' | 'priority')[];
}

@Injectable()
export class TaskParserService {

  parse(text: string): ParsedTask {
    const result: ParsedTask = { missing: [] };

    result.assigneeHint = this.extractAssignee(text);
    result.deadlineAt   = this.extractDeadline(text);
    result.priority     = this.extractPriority(text);
    result.title        = this.extractTitle(text, result.assigneeHint);

    if (!result.title)        result.missing.push('title');
    if (!result.assigneeHint) result.missing.push('assignee');
    if (!result.deadlineAt)   result.missing.push('deadline');
    if (!result.priority)     result.missing.push('priority');

    return result;
  }

  // ─── Исполнитель ───────────────────────────────────────────
  private extractAssignee(text: string): string | undefined {
    // «Илье», «для Ивана», «назначь Святославу», «поставь Алексею»
    const patterns = [
      /(?:назначь|поставь|для|задачу)\s+([А-ЯЁа-яёA-Za-z][а-яёa-z]+)/i,
      /([А-ЯЁ][а-яё]+)(?:у|е|ю)\b/,   // дативный падеж
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return undefined;
  }

  // ─── Дедлайн ───────────────────────────────────────────────
  private extractDeadline(text: string): Date | undefined {
    const now = new Date();
    const lower = text.toLowerCase();

    // «до 18:00» или «в 18:00»
    const timeMatch = lower.match(/(?:до|в|к)\s+(\d{1,2}):(\d{2})/);
    let time: { h: number; m: number } | undefined;
    if (timeMatch) {
      time = { h: parseInt(timeMatch[1]), m: parseInt(timeMatch[2]) };
    }

    const applyTime = (date: Date): Date => {
      if (time) {
        date = setHours(date, time.h);
        date = setMinutes(date, time.m);
      } else {
        date = setHours(date, 18);
        date = setMinutes(date, 0);
      }
      return date;
    };

    if (/сегодня/.test(lower)) return applyTime(new Date());
    if (/завтра/.test(lower))  return applyTime(addDays(now, 1));
    if (/послезавтра/.test(lower)) return applyTime(addDays(now, 2));

    // «через N дней/часов»
    const inDays = lower.match(/через\s+(\d+)\s+дн/);
    if (inDays) return applyTime(addDays(now, parseInt(inDays[1])));

    const inHours = lower.match(/через\s+(\d+)\s+час/);
    if (inHours) {
      const d = new Date(now.getTime() + parseInt(inHours[1]) * 3600000);
      return d;
    }

    // «в пятницу», «в понедельник» и т.д.
    const days: Record<string, Day> = {
      'понедельник': 1, 'вторник': 2, 'среду': 3, 'среда': 3,
      'четверг': 4,     'пятницу': 5, 'пятница': 5,
      'субботу': 6,     'суббота': 6, 'воскресенье': 0,
    };
    for (const [word, dayNum] of Object.entries(days)) {
      if (lower.includes(word)) {
        const target = nextDay(now, dayNum as Day);
        return applyTime(target);
      }
    }

    // «до ДД.ММ» или «до ДД/ММ»
    const dateMatch = lower.match(/до\s+(\d{1,2})[./](\d{1,2})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      const year = now.getFullYear();
      const d = new Date(year, month, day);
      return applyTime(d);
    }

    return undefined;
  }

  // ─── Приоритет ─────────────────────────────────────────────
  private extractPriority(text: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined {
    const lower = text.toLowerCase();
    if (/критич|горит|немедленно|asap/.test(lower)) return 'CRITICAL';
    if (/срочно|важно|высок|приоритет/.test(lower)) return 'HIGH';
    if (/низк|не срочно|не важно/.test(lower)) return 'LOW';
    return undefined;
  }

  // ─── Название задачи ───────────────────────────────────────
  private extractTitle(text: string, assignee?: string): string | undefined {
    let cleaned = text
      // Убираем глаголы-триггеры
      .replace(/^(поставь|создай|добавь|назначь)\s+/i, '')
      // Убираем «задачу»
      .replace(/задачу?\s*/i, '')
      // Убираем упоминание исполнителя
      .replace(assignee ? new RegExp(`(для\\s+)?${assignee}[а-яё]*\\s*`, 'i') : /^/, '')
      // Убираем временные выражения
      .replace(/до\s+\d{1,2}[:.]\d{2}(\s+мск)?/i, '')
      .replace(/в\s+\d{1,2}:\d{2}/i, '')
      .replace(/до\s+\d{1,2}[./]\d{1,2}/i, '')
      .replace(/через\s+\d+\s+(дн\S*|час\S*)/i, '')
      .replace(/\b(сегодня|завтра|послезавтра|в\s+понедельник|в\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|в\s+субботу|в\s+воскресенье)\b/i, '')
      // Убираем приоритет
      .replace(/\b(срочно|важно|высокий приоритет|критично|горит|asap)\b/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Капитализируем
    if (cleaned.length > 1) {
      cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
    }

    return cleaned.length >= 3 ? cleaned : undefined;
  }

  // ─── Форматировать подтверждение для бота ─────────────────
  formatConfirmation(parsed: ParsedTask, projectTitle?: string): string {
    const lines: string[] = ['*Создать задачу?*', ''];
    if (projectTitle) lines.push(`📂 Проект: ${projectTitle}`);
    if (parsed.title) lines.push(`📌 Название: ${parsed.title}`);
    if (parsed.assigneeHint) lines.push(`👤 Исполнитель: ${parsed.assigneeHint}`);
    if (parsed.deadlineAt) {
      const fmt = parsed.deadlineAt.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Moscow',
      });
      lines.push(`📅 Дедлайн: ${fmt} МСК`);
    }
    if (parsed.priority) {
      const map = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', CRITICAL: 'Критический' };
      lines.push(`⚡ Приоритет: ${map[parsed.priority]}`);
    }
    return lines.join('\n');
  }
}

type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;
