// Единый разбор дат и времени для задач, напоминаний и т.д.
// Поддерживаемые форматы даты: DD.MM.YYYY, DD.MM.YY, DD.MM (тогда — текущий год).
// Разделители даты: . / -
// Время: HH:MI (например 12:30). Разделители: : .
// Относительные: сегодня, завтра, послезавтра, через N дней.

function normalizeYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

// Ищет время HH:MI в тексте. Возвращает {hours, minutes} или undefined.
function findTime(text: string): { hours: number; minutes: number } | undefined {
  const m = text.match(/(?<![\d./-])(\d{1,2})[:.](\d{2})(?![\d./-])/);
  if (!m) return undefined;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return { hours, minutes };
}

// Ищет дату DD.MM(.YY(YY))? в тексте. Возвращает {day, month, year?} или undefined.
function findDate(text: string): { day: number; month: number; year?: number } | undefined {
  const m = text.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?!\d)/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
  return { day, month, year: m[3] ? normalizeYear(Number(m[3])) : undefined };
}

export interface ParseDateTimeOptions {
  // Час по умолчанию, если время не указано (для дедлайнов задач — 12:00).
  defaultHour?: number;
  defaultMinute?: number;
}

// Главная функция. Возвращает Date или undefined, если ничего не нашли.
export function parseDateTime(input: string, options: ParseDateTimeOptions = {}): Date | undefined {
  const text = input.toLowerCase().trim();
  const now = new Date();
  const time = findTime(text);
  const defaultHour = options.defaultHour ?? 12;
  const defaultMinute = options.defaultMinute ?? 0;
  const hours = time?.hours ?? defaultHour;
  const minutes = time?.minutes ?? defaultMinute;

  // Относительные даты
  if (/\bпослезавтра\b/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
  if (/\bзавтра\b/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
  const inDays = text.match(/через\s+(\d+)\s+д/);
  if (inDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(inDays[1]));
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
  if (/\bсегодня\b/.test(text)) {
    const d = new Date(now);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Явная дата DD.MM(.YY(YY))?
  const date = findDate(text);
  if (date) {
    const year = date.year ?? now.getFullYear();
    const d = new Date(year, date.month - 1, date.day, hours, minutes, 0, 0);
    if (Number.isFinite(d.getTime())) return d;
  }

  // Только время — сегодня; если уже прошло, переносим на завтра.
  if (time) {
    const d = new Date(now);
    d.setHours(time.hours, time.minutes, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  return undefined;
}
