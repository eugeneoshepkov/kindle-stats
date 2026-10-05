import { parseDayKey } from "./model";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
const fullDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthYear = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short" });
const monthOnly = new Intl.DateTimeFormat(undefined, { month: "short" });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });

export function formatCount(value: number): string {
  return integer.format(value);
}

export function formatPercent(value: number): string {
  return percent.format(value);
}

/** Headline hours: "1,192 h", "12.4 h", or minutes below an hour. */
export function formatHours(ms: number): string {
  if (ms < HOUR_MS) {
    return `${integer.format(ms / MINUTE_MS)} min`;
  }
  const hours = ms / HOUR_MS;
  return `${hours >= 100 ? integer.format(hours) : oneDecimal.format(hours)} h`;
}

/** Precise duration: "2 h 05 min", "45 min", "< 1 min". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / MINUTE_MS);
  if (totalMinutes < 1) {
    return "< 1 min";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${integer.format(hours)} h` : `${integer.format(hours)} h ${String(minutes).padStart(2, "0")} min`;
}

function toDate(value: number | string): Date {
  return typeof value === "string" ? parseDayKey(value) : new Date(value);
}

export function formatDate(value: number | string): string {
  return fullDate.format(toDate(value));
}

export function formatShortDate(value: number | string): string {
  return shortDate.format(toDate(value));
}

export function formatMonthYear(monthKey: string): string {
  return monthYear.format(parseDayKey(`${monthKey}-01`));
}

export function formatMonth(monthKey: string): string {
  return monthOnly.format(parseDayKey(`${monthKey}-01`));
}

/** Monday = 0. */
export function weekdayName(index: number, style: "long" | "short" = "long"): string {
  // 2024-01-01 was a Monday.
  const date = new Date(2024, 0, 1 + index);
  return (style === "long" ? weekdayLong : weekdayShort).format(date);
}

export function formatHourRange(hour: number): string {
  const pad = (value: number) => String(value % 24).padStart(2, "0");
  return `${pad(hour)}:00–${pad(hour + 1)}:00`;
}

export function joinAuthors(authors: string[]): string {
  return authors.length > 0 ? authors.join(", ") : "Unknown author";
}
