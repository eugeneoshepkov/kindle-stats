import { DAY_MS, dayAfter, parseDayKey, type Book, type DayEntry, type Library } from "./model";

export type Period = { kind: "all" } | { kind: "year"; year: number };

export type Streak = { length: number; start: string; end: string };

export type SeriesPoint = { key: string; value: number; compare?: number };

export function periodKey(period: Period): string {
  return period.kind === "all" ? "all" : String(period.year);
}

export function entriesIn(library: Library, period: Period): DayEntry[] {
  return period.kind === "all" ? library.entries : library.entries.filter((entry) => entry.year === period.year);
}

/** Calendar days in [start, end]. */
export function daysInclusive(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / DAY_MS) + 1;
}

/** The days a period spans: a year is clipped to the data's first and last day, "all" spans the whole export. */
export function periodBounds(library: Library, period: Period): { start: string; end: string } | null {
  if (library.entries.length === 0) {
    return null;
  }

  if (period.kind === "all") {
    return { start: library.firstDay, end: library.lastDay };
  }

  const start = `${period.year}-01-01` < library.firstDay ? library.firstDay : `${period.year}-01-01`;
  const end = `${period.year}-12-31` > library.lastDay ? library.lastDay : `${period.year}-12-31`;
  return start <= end ? { start, end } : null;
}

export function dailyTotals(entries: DayEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.day, (totals.get(entry.day) ?? 0) + entry.ms);
  }
  return totals;
}

/**
 * Longest run of consecutive reading days, plus the run still alive at `today`
 * (one that ended yesterday is still alive: today may not be over yet).
 */
export function streaks(days: Iterable<string>, today?: string): { longest: Streak | null; current: Streak | null } {
  const sorted = [...new Set(days)].sort();
  let longest: Streak | null = null;
  let run: Streak | null = null;

  for (const day of sorted) {
    if (run !== null && dayAfter(run.end, 1) === day) {
      run = { start: run.start, length: run.length + 1, end: day };
    } else {
      run = { length: 1, start: day, end: day };
    }
    if (!longest || run.length > longest.length) {
      longest = run;
    }
  }

  const current = run && today && (run.end === today || run.end === dayAfter(today, -1)) ? run : null;
  return { longest, current };
}

export function finishesIn(library: Library, period: Period): Array<{ book: Book; date: string }> {
  const finishes: Array<{ book: Book; date: string }> = [];
  for (const book of library.books) {
    for (const date of book.finishedOn) {
      if (period.kind === "all" || date.startsWith(`${period.year}-`)) {
        finishes.push({ book, date });
      }
    }
  }
  return finishes.sort((left, right) => right.date.localeCompare(left.date));
}

export type PeriodSummary = {
  totalMs: number;
  readingDays: number;
  periodDays: number;
  finished: number;
  avgPerReadingDayMs: number;
  longestStreak: Streak | null;
  /** Only set when the period contains the export's last day. */
  currentStreak: Streak | null;
};

export function summarize(library: Library, period: Period): PeriodSummary {
  const entries = entriesIn(library, period);
  const daily = dailyTotals(entries);
  const bounds = periodBounds(library, period);
  const totalMs = entries.reduce((sum, entry) => sum + entry.ms, 0);
  const { longest, current } = streaks(daily.keys(), library.lastDay);

  return {
    totalMs,
    readingDays: daily.size,
    periodDays: bounds ? daysInclusive(bounds.start, bounds.end) : 0,
    finished: finishesIn(library, period).length,
    avgPerReadingDayMs: daily.size > 0 ? totalMs / daily.size : 0,
    longestStreak: longest,
    currentStreak: bounds && bounds.end === library.lastDay ? current : null
  };
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** Reading time per month. A year is compared month by month with the year before it. */
export function monthlySeries(library: Library, period: Period): SeriesPoint[] {
  const totals = new Map<string, number>();
  for (const entry of library.entries) {
    const key = entry.day.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + entry.ms);
  }

  if (period.kind === "year") {
    const hasPreviousYear = library.entries.some((entry) => entry.year === period.year - 1);
    return Array.from({ length: 12 }, (_, month) => ({
      key: monthKey(period.year, month),
      value: totals.get(monthKey(period.year, month)) ?? 0,
      compare: hasPreviousYear ? (totals.get(monthKey(period.year - 1, month)) ?? 0) : undefined
    }));
  }

  const bounds = periodBounds(library, period);
  if (!bounds) {
    return [];
  }

  const points: SeriesPoint[] = [];
  let year = Number(bounds.start.slice(0, 4));
  let month = Number(bounds.start.slice(5, 7)) - 1;
  const endKey = bounds.end.slice(0, 7);
  while (monthKey(year, month) <= endKey) {
    points.push({ key: monthKey(year, month), value: totals.get(monthKey(year, month)) ?? 0 });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return points;
}

/** Books by reading time; hidden books (index -1) are left out. */
export function topBooks(library: Library, entries: DayEntry[], limit: number): Array<{ book: Book; ms: number }> {
  const totals = new Map<number, number>();
  for (const entry of entries) {
    if (entry.book >= 0) {
      totals.set(entry.book, (totals.get(entry.book) ?? 0) + entry.ms);
    }
  }

  return [...totals]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([index, ms]) => ({ book: library.books[index], ms }));
}

/** Monday = 0. */
export function weekdayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

export type YearSummary = PeriodSummary & { year: number };

export function yearSummaries(library: Library): YearSummary[] {
  return library.years.map((year) => ({ ...summarize(library, { kind: "year", year }), year }));
}

export type ActivityUnit = "day" | "week" | "month";

/** Reading time for one book, bucketed by day, week (Mondays) or month depending on how long it was read. */
export function bookActivity(entries: DayEntry[]): { unit: ActivityUnit; points: SeriesPoint[] } {
  if (entries.length === 0) {
    return { unit: "day", points: [] };
  }

  const first = entries.reduce((min, entry) => (entry.day < min ? entry.day : min), entries[0].day);
  const last = entries.reduce((max, entry) => (entry.day > max ? entry.day : max), entries[0].day);
  const span = daysInclusive(first, last);
  const unit: ActivityUnit = span <= 45 ? "day" : span <= 400 ? "week" : "month";
  const bucketOf = (day: string) =>
    unit === "day" ? day : unit === "week" ? dayAfter(day, -weekdayIndex(parseDayKey(day).getTime())) : day.slice(0, 7);
  const step = (key: string) => {
    if (unit === "day") {
      return dayAfter(key, 1);
    }
    if (unit === "week") {
      return dayAfter(key, 7);
    }
    const [year, month] = key.split("-").map(Number);
    return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  };

  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = bucketOf(entry.day);
    totals.set(key, (totals.get(key) ?? 0) + entry.ms);
  }

  const points: SeriesPoint[] = [];
  for (let key = bucketOf(first); key <= bucketOf(last); key = step(key)) {
    points.push({ key, value: totals.get(key) ?? 0 });
  }
  return { unit, points };
}
