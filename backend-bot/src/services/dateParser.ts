export type DateParseOptions = {
  defaultHour?: number;
  defaultMinute?: number;
  now?: Date;
};

type ParsedTime = {
  hour: number;
  minute: number;
};

type ParsedDate = {
  year: number;
  month: number;
  day: number;
  hasYear: boolean;
};

const MSK_OFFSET_HOURS = 3;

const monthNames = new Map<string, number>([
  ["января", 1],
  ["январь", 1],
  ["янв", 1],
  ["февраля", 2],
  ["февраль", 2],
  ["фев", 2],
  ["марта", 3],
  ["март", 3],
  ["мар", 3],
  ["апреля", 4],
  ["апрель", 4],
  ["апр", 4],
  ["мая", 5],
  ["май", 5],
  ["июня", 6],
  ["июнь", 6],
  ["июля", 7],
  ["июль", 7],
  ["августа", 8],
  ["август", 8],
  ["авг", 8],
  ["сентября", 9],
  ["сентябрь", 9],
  ["сен", 9],
  ["сент", 9],
  ["октября", 10],
  ["октябрь", 10],
  ["окт", 10],
  ["ноября", 11],
  ["ноябрь", 11],
  ["ноя", 11],
  ["декабря", 12],
  ["декабрь", 12],
  ["дек", 12],
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sep", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
]);

const monthPattern = [...monthNames.keys()].sort((a, b) => b.length - a.length).join("|");
const leftBoundary = "(?<![\\p{L}\\p{N}_])";
const rightBoundary = "(?![\\p{L}\\p{N}_])";

const weekdayPatterns: Array<{ pattern: RegExp; day: number }> = [
  { pattern: /(?<![\p{L}\p{N}_])(?:пн|понедельник|понедельника|понедельнику|monday|mon)(?![\p{L}\p{N}_])/iu, day: 1 },
  { pattern: /(?<![\p{L}\p{N}_])(?:вт|вторник|вторника|вторнику|tuesday|tue)(?![\p{L}\p{N}_])/iu, day: 2 },
  { pattern: /(?<![\p{L}\p{N}_])(?:ср|среда|среду|среды|wednesday|wed)(?![\p{L}\p{N}_])/iu, day: 3 },
  { pattern: /(?<![\p{L}\p{N}_])(?:чт|четверг|четверга|четвергу|thursday|thu)(?![\p{L}\p{N}_])/iu, day: 4 },
  { pattern: /(?<![\p{L}\p{N}_])(?:пт|пятница|пятницу|пятницы|friday|fri)(?![\p{L}\p{N}_])/iu, day: 5 },
  { pattern: /(?<![\p{L}\p{N}_])(?:сб|суббота|субботу|субботы|saturday|sat)(?![\p{L}\p{N}_])/iu, day: 6 },
  { pattern: /(?<![\p{L}\p{N}_])(?:вс|воскресенье|воскресенья|воскресенью|sunday|sun)(?![\p{L}\p{N}_])/iu, day: 0 },
];

export function parseDateTime(input: string, options: DateParseOptions = {}) {
  const text = normalize(input);
  if (!text) return undefined;

  const now = options.now ?? new Date();
  const time = findTime(text) ?? { hour: options.defaultHour ?? 9, minute: options.defaultMinute ?? 0 };

  const relative = parseRelative(text, time, now);
  if (relative) return relative;

  const explicitDate = parseIsoDate(text, now) ?? parseNumericDate(text, now) ?? parseMonthNameDate(text, now) ?? parseWeekday(text, time, now);
  if (explicitDate) {
    return moveToFutureIfNeeded(makeMskDate(explicitDate.year, explicitDate.month, explicitDate.day, time.hour, time.minute), explicitDate.hasYear);
  }

  const timeOnly = findTime(text);
  if (timeOnly) {
    const parts = mskParts(now);
    const candidate = makeMskDate(parts.year, parts.month, parts.day, timeOnly.hour, timeOnly.minute);
    return candidate.getTime() > now.getTime() ? candidate : makeMskDate(parts.year, parts.month, parts.day + 1, timeOnly.hour, timeOnly.minute);
  }

  return undefined;
}

export function stripDateTimePhrases(input: string) {
  return input
    .replace(new RegExp(`${leftBoundary}(?:до|к|на)?\\s*\\d{4}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}(?:\\s*(?:в|к|на)?\\s*\\d{1,2}(?::\\d{2})?)?${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}(?:до|к|на)?\\s*\\d{1,2}\\s+(?:${monthPattern})(?:\\s+\\d{2,4})?${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}(?:до|к|на)?\\s*\\d{1,2}[.\\-/]\\d{1,2}(?:[.\\-/]\\d{2,4})?${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}через\\s+\\d+\\s*(?:минуту|минуты|минут|час|часа|часов|день|дня|дней|неделю|недели|недель)${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}(?:сегодня|завтра|послезавтра|today|tomorrow)${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}(?:до|к|на)?\\s*(?:пн|понедельник|понедельника|понедельнику|вт|вторник|вторника|вторнику|ср|среда|среду|среды|чт|четверг|четверга|четвергу|пт|пятница|пятницу|пятницы|сб|суббота|субботу|субботы|вс|воскресенье|воскресенья|воскресенью|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}(?:в|к|на)\\s*\\d{1,2}(?::\\d{2}|\\.\\d{2})?\\s*(?:ч|час|часа|часов)?${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}\\d{1,2}:\\d{2}${rightBoundary}`, "giu"), " ")
    .replace(new RegExp(`${leftBoundary}(?:до|к|на|в)${rightBoundary}`, "giu"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(input: string) {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function findTime(text: string): ParsedTime | undefined {
  const colon = text.match(/(?<![\p{L}\p{N}_])(?:в|к|на|до)?\s*([01]?\d|2[0-3]):([0-5]\d)(?![\p{L}\p{N}_])/iu);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]) };

  const dottedWithPreposition = text.match(/(?<![\p{L}\p{N}_])(?:в|к|на|до)\s*([01]?\d|2[0-3])\.([0-5]\d)(?![\p{L}\p{N}_])/iu);
  if (dottedWithPreposition) return { hour: Number(dottedWithPreposition[1]), minute: Number(dottedWithPreposition[2]) };

  const hourWord = text.match(/(?<![\p{L}\p{N}_])(?:в|к|на|до)\s*([01]?\d|2[0-3])\s*(?:ч|час|часа|часов|h)(?![\p{L}\p{N}_])/iu);
  if (hourWord) return { hour: Number(hourWord[1]), minute: 0 };

  return undefined;
}

function parseRelative(text: string, time: ParsedTime, now: Date) {
  const parts = mskParts(now);

  if (/(?<![\p{L}\p{N}_])сегодня(?![\p{L}\p{N}_])/iu.test(text)) {
    const date = makeMskDate(parts.year, parts.month, parts.day, time.hour, time.minute);
    return date.getTime() > now.getTime() ? date : makeMskDate(parts.year, parts.month, parts.day + 1, time.hour, time.minute);
  }
  if (/(?<![\p{L}\p{N}_])(?:завтра|tomorrow)(?![\p{L}\p{N}_])/iu.test(text)) {
    return makeMskDate(parts.year, parts.month, parts.day + 1, time.hour, time.minute);
  }
  if (/(?<![\p{L}\p{N}_])послезавтра(?![\p{L}\p{N}_])/iu.test(text)) {
    return makeMskDate(parts.year, parts.month, parts.day + 2, time.hour, time.minute);
  }

  const relative = text.match(/(?<![\p{L}\p{N}_])через\s+(\d+)\s*(минуту|минуты|минут|час|часа|часов|день|дня|дней|неделю|недели|недель)(?![\p{L}\p{N}_])/iu);
  if (!relative) return undefined;

  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  if (unit.startsWith("мин")) return new Date(now.getTime() + amount * 60_000);
  if (unit.startsWith("час")) return new Date(now.getTime() + amount * 3_600_000);
  if (unit.startsWith("нед")) return makeMskDate(parts.year, parts.month, parts.day + amount * 7, time.hour, time.minute);
  return makeMskDate(parts.year, parts.month, parts.day + amount, time.hour, time.minute);
}

function parseIsoDate(text: string, now: Date): ParsedDate | undefined {
  const match = text.match(/(?<![\p{L}\p{N}_])(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?![\p{L}\p{N}_])/u);
  if (!match) return undefined;
  return validDate(Number(match[1]), Number(match[2]), Number(match[3]), true, now);
}

function parseNumericDate(text: string, now: Date): ParsedDate | undefined {
  const match = text.match(/(?<![\p{L}\p{N}_])(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?(?![\p{L}\p{N}_])/u);
  if (!match) return undefined;
  const year = match[3] ? normalizeYear(Number(match[3])) : mskParts(now).year;
  return validDate(year, Number(match[2]), Number(match[1]), Boolean(match[3]), now);
}

function parseMonthNameDate(text: string, now: Date): ParsedDate | undefined {
  const match = text.match(new RegExp(`${leftBoundary}(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{2,4}))?${rightBoundary}`, "iu"));
  if (!match) return undefined;
  const month = monthNames.get(match[2].toLowerCase());
  if (!month) return undefined;
  const year = match[3] ? normalizeYear(Number(match[3])) : mskParts(now).year;
  return validDate(year, month, Number(match[1]), Boolean(match[3]), now);
}

function parseWeekday(text: string, time: ParsedTime, now: Date): ParsedDate | undefined {
  const target = weekdayPatterns.find((item) => item.pattern.test(text));
  if (!target) return undefined;

  const parts = mskParts(now);
  let diff = (target.day - parts.weekday + 7) % 7;
  if (diff === 0) {
    const today = makeMskDate(parts.year, parts.month, parts.day, time.hour, time.minute);
    diff = today.getTime() > now.getTime() ? 0 : 7;
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day + diff,
    hasYear: false,
  };
}

function validDate(year: number, month: number, day: number, hasYear: boolean, _now: Date): ParsedDate | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const check = makeMskDate(year, month, day, 12, 0);
  const parts = mskParts(check);
  if (parts.year !== year || parts.month !== month || parts.day !== day) return undefined;
  return { year, month, day, hasYear };
}

function makeMskDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - MSK_OFFSET_HOURS, minute, 0, 0));
}

function moveToFutureIfNeeded(date: Date, hasYear: boolean) {
  if (hasYear || date.getTime() > Date.now()) return date;
  return makeMskDate(date.getUTCFullYear() + 1, date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours() + MSK_OFFSET_HOURS, date.getUTCMinutes());
}

function normalizeYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function mskParts(date: Date) {
  const shifted = new Date(date.getTime() + MSK_OFFSET_HOURS * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}
