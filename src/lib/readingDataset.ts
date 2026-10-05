import type {
  NormalizedAnnotation,
  NormalizedBook,
  NormalizedCompletion,
  NormalizedReadingSession
} from "./types";

export const READING_DATASET_VERSION = 2;

/** Kindle logs reading in page-level fragments; fragments closer than this form one sitting. */
export const SITTING_GAP_SECONDS = 10 * 60;

export const SITTING_BINS = [
  { label: "Under 5 min", maxMinutes: 5 },
  { label: "5–15 min", maxMinutes: 15 },
  { label: "15–30 min", maxMinutes: 30 },
  { label: "30–60 min", maxMinutes: 60 },
  { label: "1 h or more", maxMinutes: Number.POSITIVE_INFINITY }
] as const;

export type DatasetBook = {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  seriesTitle: string | null;
  genres: string[];
  /** Dates (YYYY-MM-DD) Kindle recorded the book as finished, oldest first. */
  finishedOn: string[];
  highlights: number;
  sittings: number;
};

/** [bookIndex, dayOffset, seconds]: reading per book per day. bookIndex -1 is reading not attributed to a listed book. */
export type DatasetDay = [number, number, number];

export type HabitSummary = {
  /** Seconds read by [weekday (Monday = 0)][hour]. */
  hours: number[][];
  sittingCount: number;
  medianSittingSeconds: number;
  longestSittingSeconds: number;
  /** [sittings, seconds] per SITTING_BINS entry. */
  sittingBins: Array<[number, number]>;
};

/**
 * Everything the dashboard shows, pre-aggregated in the reader's time zone. It deliberately holds no
 * session timestamps, so a published copy can't be mined for exact reading times.
 */
export type ReadingDataset = {
  version: number;
  generatedAt: string;
  /** IANA zone every day and hour below is expressed in. */
  timeZone: string;
  /** First and last day (YYYY-MM-DD) with reading; day offsets count from firstDay. */
  firstDay: string | null;
  lastDay: string | null;
  books: DatasetBook[];
  days: DatasetDay[];
  /** Keyed by "all" or a year such as "2025". */
  habits: Record<string, HabitSummary>;
};

export type ReadingDatasetInput = {
  books: NormalizedBook[];
  sessions: NormalizedReadingSession[];
  completions: NormalizedCompletion[];
  annotations: NormalizedAnnotation[];
  timeZone: string;
  /** Duplicate book id → the id it is the same book as, or null to drop a non-book entirely. */
  canonicalIds?: Map<string, string | null>;
  /** Books whose reading counts toward totals without being listed (e.g. Kindle's "untitled" catch-all). */
  unlistedIds?: Set<string>;
  /** Books Kindle marked finished by mistake (an automatic mark when the file opened at its end). */
  notFinishedIds?: Set<string>;
  generatedAt?: string;
};

/**
 * Kindle exports the same reading twice: Reading Insights sessions and device reading sessions cover the same
 * time. Summing both doubles every total, so Reading Insights is the source of truth, and device sessions only
 * fill the gap after its last recorded session (it lags the device log by a day or so).
 */
export function selectReadingSessions(sessions: NormalizedReadingSession[]): NormalizedReadingSession[] {
  const timed = sessions.filter((session) => session.startTime && session.durationMs > 0);
  const primary = timed.filter((session) => session.source === "readingInsights");
  if (primary.length === 0) {
    return timed;
  }

  const primaryEnd = Math.max(...primary.map((session) => Date.parse(session.startTime!) + session.durationMs));
  const backfill = timed.filter(
    (session) => session.source === "deviceReadingSession" && Date.parse(session.startTime!) >= primaryEnd
  );

  return [...primary, ...backfill];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ZonedTime = { day: string; weekday: number; hour: number; minute: number; second: number };

/** Wall-clock parts of an instant in `timeZone`. */
export function zonedClock(timeZone: string): (ms: number) => ZonedTime {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return (ms) => {
    const parts: Record<string, string> = {};
    for (const part of format.formatToParts(new Date(ms))) {
      parts[part.type] = part.value;
    }
    return {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: WEEKDAYS.indexOf(parts.weekday),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second)
    };
  };
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

type TimedSession = { book: number; start: number; end: number; ms: number };
type Sitting = { start: number; ms: number };

function toSittings(sessions: TimedSession[]): Sitting[] {
  const sittings: Sitting[] = [];
  let current: (Sitting & { end: number }) | null = null;
  for (const session of [...sessions].sort((left, right) => left.start - right.start)) {
    if (current && session.start - current.end <= SITTING_GAP_SECONDS * 1000) {
      current.end = Math.max(current.end, session.end);
      current.ms += session.ms;
    } else {
      current = { start: session.start, end: session.end, ms: session.ms };
      sittings.push(current);
    }
  }
  return sittings;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function emptyHabits(): { hours: number[][]; sittings: Sitting[] } {
  return { hours: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)), sittings: [] };
}

/** Folds duplicates into their canonical book and drops excluded ones, across every per-book record. */
function applyCanonicalIds<T extends { bookId: string }>(records: T[], canonicalIds: Map<string, string | null>): T[] {
  return records.flatMap((record) => {
    if (!canonicalIds.has(record.bookId)) {
      return [record];
    }
    const canonical = canonicalIds.get(record.bookId);
    return canonical ? [{ ...record, bookId: canonical }] : [];
  });
}

export function buildReadingDataset(rawInput: ReadingDatasetInput): ReadingDataset {
  const canonicalIds = rawInput.canonicalIds ?? new Map<string, string | null>();
  const input = {
    ...rawInput,
    books: rawInput.books.filter((book) => !canonicalIds.has(book.id)),
    sessions: applyCanonicalIds(rawInput.sessions, canonicalIds),
    completions: applyCanonicalIds(rawInput.completions, canonicalIds).filter(
      (completion) => !rawInput.notFinishedIds?.has(completion.bookId)
    ),
    annotations: applyCanonicalIds(rawInput.annotations, canonicalIds)
  };
  const clock = zonedClock(input.timeZone);

  const finishedByBook = new Map<string, Set<string>>();
  for (const completion of input.completions) {
    if (completion.completedAt) {
      const dates = finishedByBook.get(completion.bookId) ?? new Set<string>();
      dates.add(completion.completedAt.slice(0, 10));
      finishedByBook.set(completion.bookId, dates);
    }
  }

  const highlightsByBook = new Map<string, number>();
  for (const annotation of input.annotations) {
    if (annotation.annotationType === "kindle.highlight") {
      highlightsByBook.set(annotation.bookId, (highlightsByBook.get(annotation.bookId) ?? 0) + 1);
    }
  }

  const unlisted = input.unlistedIds ?? new Set<string>();
  const selected = selectReadingSessions(input.sessions);
  const readBookIds = new Set(selected.map((session) => session.bookId));
  const books = input.books.filter(
    (book) => !unlisted.has(book.id) && (readBookIds.has(book.id) || finishedByBook.has(book.id))
  );
  const bookIndex = new Map(books.map((book, index) => [book.id, index]));

  const sessions: TimedSession[] = selected
    .filter((session) => bookIndex.has(session.bookId) || unlisted.has(session.bookId))
    .map((session) => {
      const start = Date.parse(session.startTime!);
      return { book: bookIndex.get(session.bookId) ?? -1, start, end: start + session.durationMs, ms: session.durationMs };
    })
    .sort((left, right) => left.start - right.start);

  const startDays = sessions.map((session) => clock(session.start).day);
  const firstDay = startDays.length > 0 ? startDays.reduce((min, day) => (day < min ? day : min)) : null;
  const lastDay = sessions.length > 0 ? clock(Math.max(...sessions.map((session) => session.end))).day : null;

  // Reading is attributed to the day each session started, as Kindle's own day totals do.
  const dayTotals = new Map<string, number>();
  sessions.forEach((session, index) => {
    const key = `${session.book}|${startDays[index]}`;
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + session.ms);
  });
  const days: DatasetDay[] = [...dayTotals]
    .map(([key, ms]): DatasetDay => {
      const [book, day] = key.split("|");
      return [Number(book), dayNumber(day) - dayNumber(firstDay!), Math.round(ms / 1000)];
    })
    .sort((left, right) => left[1] - right[1] || left[0] - right[0]);

  // Habit grids split each session across the wall-clock hours it spans.
  const periods = new Map<string, ReturnType<typeof emptyHabits>>([["all", emptyHabits()]]);
  const periodFor = (year: string) => {
    if (!periods.has(year)) {
      periods.set(year, emptyHabits());
    }
    return periods.get(year)!;
  };
  sessions.forEach((session, index) => {
    const year = periodFor(startDays[index].slice(0, 4));
    let cursor = session.start;
    while (cursor < session.end) {
      const time = clock(cursor);
      const toNextHour = ((60 - time.minute) * 60 - time.second) * 1000 - (cursor % 1000);
      const sliceEnd = Math.min(session.end, cursor + Math.max(1000, toNextHour));
      const seconds = (sliceEnd - cursor) / 1000;
      periods.get("all")!.hours[time.weekday][time.hour] += seconds;
      year.hours[time.weekday][time.hour] += seconds;
      cursor = sliceEnd;
    }
  });

  for (const sitting of toSittings(sessions)) {
    periods.get("all")!.sittings.push(sitting);
    periodFor(clock(sitting.start).day.slice(0, 4)).sittings.push(sitting);
  }

  const habits: Record<string, HabitSummary> = {};
  for (const [key, period] of periods) {
    const bins = SITTING_BINS.map((): [number, number] => [0, 0]);
    for (const sitting of period.sittings) {
      const bin = bins[SITTING_BINS.findIndex((entry) => sitting.ms < entry.maxMinutes * 60_000)];
      bin[0] += 1;
      bin[1] += sitting.ms;
    }
    habits[key] = {
      hours: period.hours.map((row) => row.map(Math.round)),
      sittingCount: period.sittings.length,
      medianSittingSeconds: Math.round(median(period.sittings.map((sitting) => sitting.ms)) / 1000),
      longestSittingSeconds: Math.round(Math.max(0, ...period.sittings.map((sitting) => sitting.ms)) / 1000),
      sittingBins: bins.map(([count, ms]) => [count, Math.round(ms / 1000)])
    };
  }

  const sessionsByBook = books.map((): TimedSession[] => []);
  for (const session of sessions) {
    if (session.book >= 0) {
      sessionsByBook[session.book].push(session);
    }
  }

  return {
    version: READING_DATASET_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    timeZone: input.timeZone,
    firstDay,
    lastDay,
    books: books.map((book, index) => ({
      id: book.id,
      title: book.title,
      authors: book.authors,
      coverUrl: book.coverUrl,
      seriesTitle: book.seriesTitle,
      genres: book.genres,
      finishedOn: [...(finishedByBook.get(book.id) ?? [])].sort(),
      highlights: highlightsByBook.get(book.id) ?? 0,
      sittings: toSittings(sessionsByBook[index]).length
    })),
    days,
    habits
  };
}

/**
 * The copy of a dataset that is safe to publish: books listed in `hiddenBookIds` disappear (their reading time
 * still counts toward totals as bookIndex -1, their finishes don't), and Amazon ids are replaced by neutral ones.
 */
export function toPublicDataset(dataset: ReadingDataset, hiddenBookIds: Set<string>): ReadingDataset {
  const indexMap = new Map<number, number>();
  const books: DatasetBook[] = [];
  dataset.books.forEach((book, index) => {
    if (!hiddenBookIds.has(book.id)) {
      indexMap.set(index, books.length);
      books.push({ ...book, id: `b${books.length + 1}` });
    }
  });

  const merged = new Map<string, number>();
  for (const [book, day, seconds] of dataset.days) {
    const key = `${book < 0 ? -1 : (indexMap.get(book) ?? -1)}|${day}`;
    merged.set(key, (merged.get(key) ?? 0) + seconds);
  }

  return {
    ...dataset,
    books,
    days: [...merged]
      .map(([key, seconds]): DatasetDay => {
        const [book, day] = key.split("|").map(Number);
        return [book, day, seconds];
      })
      .sort((left, right) => left[1] - right[1] || left[0] - right[0])
  };
}
