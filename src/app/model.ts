import type { DatasetBook, HabitSummary, ReadingDataset } from "../lib/readingDataset";

export const DAY_MS = 86_400_000;
/** A book counts as "reading" when it was opened within this many days up to the data's last day. */
export const ACTIVE_WINDOW_DAYS = 30;
/** Reading a finished book for at least this long after its finish date counts as re-reading it. */
export const REREAD_MIN_MS = 30 * 60_000;

/** Reading of one book on one day. `book` is -1 for books hidden from a published copy. */
export type DayEntry = {
  book: number;
  /** YYYY-MM-DD in the dataset's time zone. */
  day: string;
  year: number;
  ms: number;
};

export type BookStatus = "reading" | "finished" | "unfinished";

export type Book = DatasetBook & {
  index: number;
  totalMs: number;
  readingDays: number;
  firstRead: string | null;
  lastRead: string | null;
  lastFinished: string | null;
  status: BookStatus;
};

export type Library = {
  books: Book[];
  booksById: Map<string, Book>;
  entries: DayEntry[];
  habits: Record<string, HabitSummary>;
  /** Zone the export's days and hours are expressed in, so every visitor sees the reader's own clock. */
  timeZone: string;
  firstDay: string;
  /** Last day the export covers. Streaks and "currently reading" are relative to it, not to today. */
  lastDay: string;
  years: number[];
};

export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parses YYYY-MM-DD as local midnight, for display and calendar layout. */
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The day `offset` days after `start`, computed on UTC dates so DST never shifts it. */
export function dayAfter(start: string, offset: number): string {
  const [year, month, day] = start.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export function buildLibrary(dataset: ReadingDataset): Library {
  const firstDay = dataset.firstDay ?? new Date().toISOString().slice(0, 10);
  const lastDay = dataset.lastDay ?? firstDay;
  const entries: DayEntry[] = dataset.days.map(([book, offset, seconds]) => {
    const day = dayAfter(firstDay, offset);
    return { book, day, year: Number(day.slice(0, 4)), ms: seconds * 1000 };
  });

  const activeSince = dayAfter(lastDay, -(ACTIVE_WINDOW_DAYS - 1));
  const stats = dataset.books.map((book) => ({
    totalMs: 0,
    msAfterFinish: 0,
    lastFinished: book.finishedOn.at(-1) ?? null,
    days: new Set<string>(),
    firstRead: null as string | null,
    lastRead: null as string | null
  }));
  for (const entry of entries) {
    if (entry.book < 0) {
      continue;
    }
    const book = stats[entry.book];
    book.totalMs += entry.ms;
    book.days.add(entry.day);
    if (book.lastFinished !== null && entry.day > book.lastFinished) {
      book.msAfterFinish += entry.ms;
    }
    book.firstRead = book.firstRead === null || entry.day < book.firstRead ? entry.day : book.firstRead;
    book.lastRead = book.lastRead === null || entry.day > book.lastRead ? entry.day : book.lastRead;
  }

  const books: Book[] = dataset.books.map((book, index) => {
    const entry = stats[index];
    // A finished book is "reading" again only when re-read for a while, not when briefly reopened after the end.
    const readSinceFinish = entry.lastFinished === null || entry.msAfterFinish >= REREAD_MIN_MS;
    const isActive = entry.lastRead !== null && entry.lastRead >= activeSince;

    return {
      ...book,
      index,
      totalMs: entry.totalMs,
      readingDays: entry.days.size,
      firstRead: entry.firstRead,
      lastRead: entry.lastRead,
      lastFinished: entry.lastFinished,
      status: isActive && readSinceFinish ? "reading" : entry.lastFinished ? "finished" : "unfinished"
    };
  });

  const years = new Set<number>(entries.map((entry) => entry.year));
  for (const book of books) {
    for (const date of book.finishedOn) {
      years.add(Number(date.slice(0, 4)));
    }
  }

  return {
    books,
    booksById: new Map(books.map((book) => [book.id, book])),
    entries,
    habits: dataset.habits,
    timeZone: dataset.timeZone,
    firstDay,
    lastDay,
    years: [...years].sort((left, right) => right - left)
  };
}

export async function loadLibrary(): Promise<Library> {
  const response = await fetch("/processed/reading.json", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("No reading data found. Run `bun run ingest` to generate it from your Kindle export.");
  }

  const dataset = (await response.json()) as ReadingDataset;
  if (dataset.version !== 2) {
    throw new Error("The reading data is from an older version. Run `bun run metrics` to regenerate it.");
  }
  return buildLibrary(dataset);
}
