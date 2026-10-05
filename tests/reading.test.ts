import { describe, expect, test } from "bun:test";
import { buildLibrary } from "../src/app/model";
import { daysInclusive, monthlySeries, streaks, summarize, topBooks } from "../src/app/stats";
import {
  buildReadingDataset,
  selectReadingSessions,
  toPublicDataset,
  type DatasetBook,
  type ReadingDataset
} from "../src/lib/readingDataset";
import type { NormalizedBook, NormalizedReadingSession } from "../src/lib/types";

const MINUTE = 60_000;
const VIENNA = "Europe/Vienna";

function normalizedSession(overrides: Partial<NormalizedReadingSession>): NormalizedReadingSession {
  return {
    id: "s",
    bookId: "asin:A",
    source: "readingInsights",
    startTime: "2026-01-01T10:00:00.000Z",
    endTime: null,
    durationMs: 10 * MINUTE,
    marketplace: null,
    deviceFamily: null,
    contentType: null,
    pageFlips: null,
    ...overrides
  };
}

function normalizedBook(id: string): NormalizedBook {
  return {
    id,
    title: id,
    asin: null,
    isbn: null,
    personalDocumentId: null,
    nonAsinId: null,
    authors: [],
    seriesTitle: null,
    seriesAuthor: null,
    genres: [],
    tags: [],
    ownershipTypes: [],
    resourceType: null,
    contentType: null,
    marketplace: null,
    isPersonalDocument: false,
    coverUrl: null,
    coverSource: null
  };
}

function build(sessions: Array<Partial<NormalizedReadingSession>>, extra: Partial<Parameters<typeof buildReadingDataset>[0]> = {}) {
  const bookIds = [...new Set(sessions.map((session) => session.bookId ?? "asin:A"))];
  return buildReadingDataset({
    books: bookIds.map(normalizedBook),
    sessions: sessions.map(normalizedSession),
    completions: [],
    annotations: [],
    timeZone: VIENNA,
    ...extra
  });
}

function datasetBook(id: string, finishedOn: string[] = []): DatasetBook {
  return { id, title: id, authors: [], coverUrl: null, seriesTitle: null, genres: [], finishedOn, highlights: 0, sittings: 0 };
}

/** A dataset from [bookIndex, day, minutes] rows, as the pipeline would emit it. */
function dataset(books: DatasetBook[], rows: Array<[number, string, number]>, lastDay?: string): ReadingDataset {
  const days = rows.map(([, day]) => day).sort();
  const firstDay = days[0];
  return {
    version: 2,
    generatedAt: "2026-10-05T00:00:00.000Z",
    timeZone: VIENNA,
    firstDay,
    lastDay: lastDay ?? days.at(-1)!,
    books,
    days: rows.map(([book, day, minutes]) => [book, daysInclusive(firstDay, day) - 1, minutes * 60]),
    habits: {}
  };
}

describe("selectReadingSessions", () => {
  test("uses Reading Insights and ignores the duplicate device log for the same period", () => {
    const selected = selectReadingSessions([
      normalizedSession({ id: "insights", startTime: "2026-01-01T10:00:00.000Z" }),
      normalizedSession({ id: "device-duplicate", source: "deviceReadingSession", startTime: "2026-01-01T10:00:00.000Z" }),
      normalizedSession({ id: "device-later", source: "deviceReadingSession", startTime: "2026-01-02T10:00:00.000Z" })
    ]);

    expect(selected.map((session) => session.id)).toEqual(["insights", "device-later"]);
  });

  test("drops untimed and zero-length sessions, and falls back to the device log alone", () => {
    const selected = selectReadingSessions([
      normalizedSession({ id: "zero", source: "deviceReadingSession", durationMs: 0 }),
      normalizedSession({ id: "untimed", source: "deviceReadingSession", startTime: null }),
      normalizedSession({ id: "device", source: "deviceReadingSession" })
    ]);

    expect(selected.map((session) => session.id)).toEqual(["device"]);
  });
});

describe("buildReadingDataset", () => {
  test("keeps read or finished books, dedupes finish dates and counts only highlights", () => {
    const result = buildReadingDataset({
      books: [normalizedBook("asin:A"), normalizedBook("asin:B"), normalizedBook("asin:Unread")],
      sessions: [normalizedSession({ bookId: "asin:A", startTime: "2026-01-01T10:00:00.000Z", durationMs: 30 * MINUTE })],
      completions: [
        { bookId: "asin:A", completedAt: "2026-01-05T00:00:00Z", source: "readingInsights" },
        { bookId: "asin:A", completedAt: "2026-01-05T18:00:00Z", source: "autoMarkAsRead" },
        { bookId: "asin:B", completedAt: "2025-03-01T00:00:00Z", source: "readingInsights" }
      ],
      annotations: [
        { bookId: "asin:A", annotationType: "kindle.highlight", noteCount: 0, highlightCount: 0, lastUpdatedAt: null },
        { bookId: "asin:A", annotationType: "kindle.last_read", noteCount: 0, highlightCount: 0, lastUpdatedAt: null }
      ],
      timeZone: VIENNA
    });

    expect(result.books.map((book) => book.id)).toEqual(["asin:A", "asin:B"]);
    expect(result.books[0].finishedOn).toEqual(["2026-01-05"]);
    expect(result.books[0].highlights).toBe(1);
    expect(result.days).toEqual([[0, 0, 1800]]);
    expect(result.firstDay).toBe("2026-01-01");
  });

  test("attributes reading to the reader's local day and hour, in winter and summer time", () => {
    const result = build([
      // 23:30 UTC on Jan 5 is 00:30 on Tuesday Jan 6 in Vienna (UTC+1).
      { startTime: "2026-01-05T23:30:00.000Z", durationMs: 20 * MINUTE },
      // 19:10 UTC on Jul 6 is 21:10 on Monday in Vienna (UTC+2).
      { startTime: "2026-07-06T19:10:00.000Z", durationMs: 20 * MINUTE }
    ]);

    expect(result.firstDay).toBe("2026-01-06");
    expect(result.lastDay).toBe("2026-07-06");
    expect(result.days.map(([, offset]) => offset)).toEqual([0, 181]);
    expect(result.habits.all.hours[1][0]).toBe(1200);
    expect(result.habits.all.hours[0][21]).toBe(1200);
    expect(result.habits["2026"].hours[0][21]).toBe(1200);
  });

  test("splits a session across the hours it spans and merges nearby fragments into sittings", () => {
    const result = build([
      // 20:40 UTC is 21:40 in Vienna; 40 minutes run into the next hour.
      { startTime: "2026-01-05T20:40:00.000Z", durationMs: 40 * MINUTE },
      // Starts 5 minutes after the first ends: same sitting.
      { startTime: "2026-01-05T21:25:00.000Z", durationMs: 10 * MINUTE },
      { startTime: "2026-01-06T20:00:00.000Z", durationMs: 2 * MINUTE }
    ]);

    expect(result.habits.all.hours[0][21]).toBe(20 * 60);
    expect(result.habits.all.hours[0][22]).toBe(30 * 60);
    expect(result.habits.all.sittingCount).toBe(2);
    expect(result.habits.all.longestSittingSeconds).toBe(50 * 60);
    expect(result.habits.all.sittingBins.map(([count]) => count)).toEqual([1, 0, 0, 1, 0]);
    expect(result.books[0].sittings).toBe(2);
  });
});

describe("duplicates and exclusions", () => {
  test("folds a duplicate's reading and finishes into its canonical book and drops excluded books", () => {
    const result = buildReadingDataset({
      books: [normalizedBook("doc:MAIN"), normalizedBook("asin:COPY"), normalizedBook("doc:JUNK")],
      sessions: [
        normalizedSession({ bookId: "doc:MAIN", startTime: "2026-01-01T10:00:00.000Z", durationMs: 30 * MINUTE }),
        normalizedSession({ bookId: "asin:COPY", startTime: "2026-01-02T10:00:00.000Z", durationMs: 15 * MINUTE }),
        normalizedSession({ bookId: "doc:JUNK", startTime: "2026-01-02T11:00:00.000Z", durationMs: 5 * MINUTE })
      ],
      completions: [{ bookId: "asin:COPY", completedAt: "2026-01-02T00:00:00Z", source: "readingInsights" }],
      annotations: [],
      timeZone: VIENNA,
      canonicalIds: new Map([
        ["asin:COPY", "doc:MAIN"],
        ["doc:JUNK", null]
      ])
    });

    expect(result.books.map((book) => [book.id, book.finishedOn])).toEqual([["doc:MAIN", ["2026-01-02"]]]);
    expect(result.days).toEqual([
      [0, 0, 1800],
      [0, 1, 900]
    ]);
  });
});

describe("mistaken finish marks", () => {
  test("ignores Kindle's finished mark for books listed as not finished", () => {
    const result = buildReadingDataset({
      books: [normalizedBook("doc:OPENED_AT_END"), normalizedBook("doc:REALLY_DONE")],
      sessions: [
        normalizedSession({ bookId: "doc:OPENED_AT_END", startTime: "2026-09-21T18:00:00.000Z" }),
        normalizedSession({ bookId: "doc:REALLY_DONE", startTime: "2026-09-21T19:00:00.000Z" })
      ],
      completions: [
        { bookId: "doc:OPENED_AT_END", completedAt: "2026-09-21T00:00:00Z", source: "readingInsights" },
        { bookId: "doc:REALLY_DONE", completedAt: "2026-09-21T00:00:00Z", source: "readingInsights" }
      ],
      annotations: [],
      timeZone: VIENNA,
      notFinishedIds: new Set(["doc:OPENED_AT_END"])
    });

    expect(result.books.map((book) => [book.id, book.finishedOn])).toEqual([
      ["doc:OPENED_AT_END", []],
      ["doc:REALLY_DONE", ["2026-09-21"]]
    ]);
  });
});

describe("toPublicDataset", () => {
  test("drops hidden books but keeps their time, and replaces Amazon ids", () => {
    const original = dataset(
      [datasetBook("asin:SECRET", ["2026-01-02"]), datasetBook("doc:PUBLIC")],
      [
        [0, "2026-01-01", 30],
        [1, "2026-01-01", 10],
        [1, "2026-01-02", 20]
      ]
    );
    const published = toPublicDataset(original, new Set(["asin:SECRET"]));

    expect(published.books.map((book) => [book.id, book.title])).toEqual([["b1", "doc:PUBLIC"]]);
    expect(published.days).toEqual([
      [-1, 0, 1800],
      [0, 0, 600],
      [0, 1, 1200]
    ]);

    const library = buildLibrary(published);
    expect(summarize(library, { kind: "all" }).totalMs).toBe(60 * MINUTE);
    expect(summarize(library, { kind: "all" }).finished).toBe(0);
    expect(topBooks(library, library.entries, 5).map(({ book }) => book.id)).toEqual(["b1"]);
  });
});

describe("buildLibrary statuses", () => {
  test("separates reading, finished and unfinished books", () => {
    const library = buildLibrary(
      dataset(
        [datasetBook("reading"), datasetBook("just-finished", ["2026-09-20"]), datasetBook("rereading", ["2025-01-10"]), datasetBook("abandoned")],
        [
          [0, "2026-09-30", 20],
          [1, "2026-09-19", 60],
          // Reopened briefly after finishing: still finished.
          [1, "2026-09-25", 5],
          [2, "2026-09-28", 45],
          [3, "2026-03-01", 90]
        ],
        "2026-10-01"
      )
    );

    expect(library.books.map((book) => [book.id, book.status])).toEqual([
      ["reading", "reading"],
      ["just-finished", "finished"],
      ["rereading", "reading"],
      ["abandoned", "unfinished"]
    ]);
    expect(library.years).toEqual([2026, 2025]);
  });
});

describe("streaks", () => {
  test("finds the longest run and keeps a run that ended yesterday alive", () => {
    const result = streaks(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-10", "2026-01-11"], "2026-01-12");
    expect(result.longest).toEqual({ length: 3, start: "2026-01-01", end: "2026-01-03" });
    expect(result.current).toEqual({ length: 2, start: "2026-01-10", end: "2026-01-11" });
  });

  test("has no current streak after a missed day", () => {
    expect(streaks(["2026-01-01"], "2026-01-03").current).toBeNull();
  });

  test("counts calendar days across a daylight saving change", () => {
    expect(daysInclusive("2026-03-28", "2026-03-30")).toBe(3);
    expect(streaks(["2026-03-28", "2026-03-29", "2026-03-30"]).longest?.length).toBe(3);
  });
});

describe("period summaries", () => {
  test("summarizes a year against its days in the export", () => {
    const library = buildLibrary(
      dataset(
        [datasetBook("a", ["2026-02-01"]), datasetBook("b")],
        [
          [0, "2025-12-31", 30],
          [0, "2026-01-01", 30],
          [1, "2026-01-01", 15],
          [1, "2026-01-10", 60]
        ]
      )
    );

    const summary = summarize(library, { kind: "year", year: 2026 });
    expect(summary.totalMs).toBe(105 * MINUTE);
    expect(summary.readingDays).toBe(2);
    expect(summary.periodDays).toBe(10);
    expect(summary.finished).toBe(1);
    expect(summary.currentStreak?.length).toBe(1);

    const allTime = summarize(library, { kind: "all" });
    expect(allTime.longestStreak).toEqual({ length: 2, start: "2025-12-31", end: "2026-01-01" });
  });

  test("compares each month with the previous year", () => {
    const library = buildLibrary(dataset([datasetBook("a")], [[0, "2025-03-05", 60], [0, "2026-03-05", 30]]));
    const march = monthlySeries(library, { kind: "year", year: 2026 })[2];
    expect(march).toEqual({ key: "2026-03", value: 30 * MINUTE, compare: 60 * MINUTE });
  });
});
