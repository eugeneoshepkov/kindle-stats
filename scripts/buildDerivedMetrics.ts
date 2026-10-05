import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { recommendBooks } from "../src/lib/recommendBooks";
import { isGoogleBooksPlaceholderVolumeCoverUrl } from "../src/lib/googleBooksCover";
import type { GoodreadsAsinCache } from "../src/lib/goodreadsAsin";
import { mergeKindleAsinTitleHint } from "../src/lib/kindleAsinTitleHints";
import { cleanDisplayTitle, normalizeAuthors } from "../src/lib/bookNames";
import { buildReadingDataset } from "../src/lib/readingDataset";
import {
  pickBestGoogleBooksImageLink,
  resolveCoverImageUrlForDisplay,
  upgradeCoverImageUrl
} from "../src/lib/upgradeCoverUrl";
import type {
  DaypartShare,
  DashboardData,
  EnrichedBook,
  ExtractedData,
  FeaturedBook,
  GenreShare,
  ParallelReadingBook,
  ParallelReadingPoint,
  ParallelReadingSummary,
  PersonalizedRecommendation,
  ReadingMilestones,
  NormalizedBook,
  RankedDimension,
  TrendPoint
} from "../src/lib/types";

const workspaceRoot = process.cwd();
const rawDir = join(workspaceRoot, "data", "raw");
const processedDir = join(workspaceRoot, "data", "processed");
const publicProcessedDir = join(workspaceRoot, "public", "processed");
const metadataCachePath = join(processedDir, "book_metadata_cache.json");
const goodreadsAsinCachePath = join(processedDir, "goodreads_asin_cache.json");
const overridesPath = join(rawDir, "book-overrides.json");

mkdirSync(rawDir, { recursive: true });
mkdirSync(processedDir, { recursive: true });
mkdirSync(publicProcessedDir, { recursive: true });

const extracted = (await Bun.file(join(processedDir, "extracted.json")).json()) as ExtractedData;

type BookMetadataCacheEntry = {
  title: string | null;
  authors: string[];
  coverUrl: string | null;
  coverSource: string | null;
  isbn: string | null;
  updatedAt: string;
};

type BookOverrides = {
  byBookId: Record<
    string,
    {
      title?: string;
      authors?: string[];
      coverUrl?: string;
      coverSource?: string;
      isbn?: string;
      /** Leave this book out of the public build (`bun run build:public`). */
      hidden?: boolean;
      /** This entry is a duplicate of another book id; its reading, finishes and highlights move there. */
      sameAs?: string;
      /** Not a book (a stray file, an empty upload): drop it and its reading everywhere. */
      exclude?: boolean;
      /** false: keep this entry's reading in totals but don't list it as a book (e.g. unidentified reading). */
      listed?: boolean;
      /** false: ignore Kindle's "finished" mark for this book (automatic marks can fire when a file opens at its end). */
      finished?: boolean;
    }
  >;
};

async function readJsonIfExists<T>(path: string, fallback: T): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return fallback;
  }

  return (await file.json()) as T;
}

// Only reading.json is served to the browser; these older aggregates stay local in data/processed.
function writeJson(fileName: string, data: unknown): void {
  Bun.write(join(processedDir, fileName), JSON.stringify(data, null, 2));
}

function writeProcessedJson(path: string, data: unknown): void {
  Bun.write(path, JSON.stringify(data, null, 2));
}

function transliterateCyrillic(value: string): string {
  const map: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya"
  };
  return value.replace(/[А-Яа-яЁё]/g, (char) => {
    const lower = char.toLowerCase();
    const replacement = map[lower] ?? lower;
    if (char === lower) {
      return replacement;
    }
    if (replacement.length === 0) {
      return replacement;
    }
    return replacement[0].toUpperCase() + replacement.slice(1);
  });
}

async function fetchJsonWithRetries<T>(url: string, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          await Bun.sleep(250 * (attempt + 1));
          continue;
        }
        return null;
      }
      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        if (attempt < retries) {
          await Bun.sleep(250 * (attempt + 1));
          continue;
        }
        return null;
      }
    } catch {
      if (attempt < retries) {
        await Bun.sleep(250 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

function formatHours(value: number): string {
  return `${new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value)} h`;
}

function formatMinutes(value: number): string {
  return `${new Intl.NumberFormat("de-DE").format(Math.round(value))} min`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

function formatCompactHours(value: number): string {
  return `${new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value)} h`;
}

function formatDuration(valueMs: number): string {
  const totalMinutes = Math.round(valueMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function toDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}

function toMonthKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 7);
}

function rankMap(map: Map<string, number>, details?: Map<string, string>): RankedDimension[] {
  return [...map.entries()]
    .filter(([name, value]) => Boolean(name) && value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, value]) => ({
      name,
      value: Math.round(value * 10) / 10,
      detail: details?.get(name)
    }));
}

function rankStringCounts(values: Array<string | null | undefined>, limit = 8): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    map.set(value, (map.get(value) ?? 0) + 1);
  }

  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

type OpenLibraryWorkRecord = {
  key: string | null;
  title: string;
  authors: string[];
  subjects: string[];
  coverId: number | null;
  firstPublishYear: number | null;
};

type RecommendationSeed = {
  kind: "genre" | "author";
  label: string;
  query: string;
};

type RecommendationCandidate = {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  infoUrl: string | null;
  score: number;
  reasons: Set<string>;
  matchedGenres: Set<string>;
  matchedAuthors: Set<string>;
};

const genreToOpenLibrarySubjects: Record<string, string[]> = {
  "Business & Money": ["business", "economics", "finance"],
  "Politics & Social Sciences": ["politics", "social_science", "history"],
  "Professional & Technical": ["technology", "engineering", "computer_science"],
  "Computers & Technology": ["computer_science", "programming", "software_engineering"],
  "Self-Help": ["self_help", "psychology", "mental_health"],
  "Science & Math": ["science", "mathematics", "physics"],
  "Biographies & Memoirs": ["biography", "memoir", "autobiography"],
  Fiction: ["fiction", "literature"],
  History: ["history", "world_history"],
  Philosophy: ["philosophy", "ethics"],
  Health: ["health", "wellness"]
};

function normalizeToken(value: string | null | undefined): string {
  return transliterateCyrillic(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRecommendationKey(title: string, author: string): string {
  return `${normalizeToken(title)}::${normalizeToken(author)}`;
}

function mapGenreToSubjects(genre: string): string[] {
  const direct = genreToOpenLibrarySubjects[genre];
  if (direct && direct.length > 0) {
    return direct;
  }
  const fallback = normalizeToken(genre).replace(/\s+/g, "_");
  return fallback ? [fallback] : [];
}

function openLibraryCoverUrl(coverId: number | null): string | null {
  if (!coverId || !Number.isFinite(coverId)) {
    return null;
  }
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`;
}

function extractYear(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const match = value.match(/\b(18|19|20)\d{2}\b/);
    if (match) {
      return Number(match[0]);
    }
  }
  return null;
}

function isRecommendationTitleAcceptable(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 3 || trimmed.length > 140) {
    return false;
  }
  if (/^\d[\d\s.,:;/-]*$/.test(trimmed)) {
    return false;
  }
  if (/\b(report|session|minutes|proceedings|catalog|catalogue|conference|committee)\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

function confidenceFromScore(score: number): number {
  return Math.round(Math.min(0.99, Math.max(0.2, score / 10)) * 100) / 100;
}

async function fetchOpenLibrarySubjectWorks(subject: string, limit: number): Promise<OpenLibraryWorkRecord[]> {
  const payload = await fetchJsonWithRetries<{
    works?: Array<{
      key?: string;
      title?: string;
      authors?: Array<{ name?: string }>;
      subject?: string[];
      cover_id?: number;
      first_publish_year?: number;
      first_publish_date?: string;
    }>;
  }>(`https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}&details=false`);
  if (!payload) {
    return [];
  }
  return (payload.works ?? [])
    .map((work) => ({
      key: work.key ?? null,
      title: work.title ?? "",
      authors: (work.authors ?? []).map((author) => author.name ?? "").filter(Boolean),
      subjects: work.subject ?? [],
      coverId: work.cover_id ?? null,
      firstPublishYear: extractYear(work.first_publish_year ?? work.first_publish_date ?? null)
    }))
    .filter((work) => Boolean(work.title));
}

async function fetchOpenLibraryAuthorWorks(author: string, limit: number): Promise<OpenLibraryWorkRecord[]> {
  const payload = await fetchJsonWithRetries<{
    docs?: Array<{
      key?: string;
      title?: string;
      author_name?: string[];
      subject?: string[];
      cover_i?: number;
      first_publish_year?: number;
    }>;
  }>(`https://openlibrary.org/search.json?author=${encodeURIComponent(author)}&limit=${limit}`);
  if (!payload) {
    return [];
  }
  return (payload.docs ?? [])
    .map((doc) => {
      const key = doc.key?.startsWith("/") ? doc.key : doc.key ? `/works/${doc.key}` : null;
      return {
        key,
        title: doc.title ?? "",
        authors: doc.author_name ?? [],
        subjects: doc.subject ?? [],
        coverId: doc.cover_i ?? null,
        firstPublishYear: extractYear(doc.first_publish_year ?? null)
      };
    })
    .filter((work) => Boolean(work.title));
}

function upsertRecommendationCandidate(params: {
  candidates: Map<string, RecommendationCandidate>;
  existingBookKeys: Set<string>;
  work: OpenLibraryWorkRecord;
  seed: RecommendationSeed;
  favoriteSubjectToGenre: Map<string, string>;
  favoriteGenreSet: Set<string>;
}): void {
  const { candidates, existingBookKeys, work, seed, favoriteSubjectToGenre, favoriteGenreSet } = params;
  if (!isRecommendationTitleAcceptable(work.title)) {
    return;
  }
  const author = work.authors[0] ?? "Unknown author";
  const dedupeKey = normalizeRecommendationKey(work.title, author);
  if (!dedupeKey || dedupeKey === "::" || existingBookKeys.has(dedupeKey)) {
    return;
  }

  const existing =
    candidates.get(dedupeKey) ??
    ({
      id: work.key ? work.key.replace(/^\//, "") : `openlibrary:${dedupeKey}`,
      title: work.title,
      author,
      coverUrl: openLibraryCoverUrl(work.coverId),
      infoUrl: work.key ? `https://openlibrary.org${work.key}` : null,
      score: 0,
      reasons: new Set<string>(),
      matchedGenres: new Set<string>(),
      matchedAuthors: new Set<string>()
    } as RecommendationCandidate);

  if (seed.kind === "genre") {
    if (!existing.matchedGenres.has(seed.label)) {
      existing.score += 2.8;
      existing.reasons.add(`Aligned with your ${seed.label} reading focus`);
      existing.matchedGenres.add(seed.label);
    }
  } else {
    if (!existing.matchedAuthors.has(seed.label)) {
      existing.score += 3.5;
      existing.reasons.add(`Because you keep returning to ${seed.label}`);
      existing.matchedAuthors.add(seed.label);
    }
  }

  for (const subject of work.subjects) {
    const mappedGenre = favoriteSubjectToGenre.get(normalizeToken(subject));
    if (!mappedGenre || !favoriteGenreSet.has(mappedGenre)) {
      continue;
    }
    if (!existing.matchedGenres.has(mappedGenre)) {
      existing.score += 0.9;
      existing.matchedGenres.add(mappedGenre);
    }
  }

  if (work.firstPublishYear) {
    if (work.firstPublishYear >= 2018) {
      existing.score += 0.7;
    } else if (work.firstPublishYear >= 2000) {
      existing.score += 0.4;
    }
  }

  if (existing.coverUrl) {
    existing.score += 0.4;
  }

  if (existing.reasons.size === 0) {
    existing.reasons.add("Matched from your reading profile");
  }

  candidates.set(dedupeKey, existing);
}

async function buildPersonalizedRecommendations(params: {
  books: EnrichedBook[];
  favoriteGenres: string[];
  favoriteAuthors: string[];
  recentFocusAuthors: string[];
}): Promise<PersonalizedRecommendation[]> {
  const { books, favoriteGenres, favoriteAuthors, recentFocusAuthors } = params;
  const existingBookKeys = new Set(
    books.map((book) => normalizeRecommendationKey(book.title, book.authors[0] ?? "Unknown author"))
  );
  const favoriteSubjectToGenre = new Map<string, string>();
  const favoriteGenreSet = new Set(favoriteGenres);

  const genreSeeds: RecommendationSeed[] = [];
  const seenGenreQueries = new Set<string>();
  for (const genre of favoriteGenres.slice(0, 4)) {
    for (const subject of mapGenreToSubjects(genre).slice(0, 2)) {
      const normalized = normalizeToken(subject);
      if (!normalized || seenGenreQueries.has(normalized)) {
        continue;
      }
      seenGenreQueries.add(normalized);
      genreSeeds.push({ kind: "genre", label: genre, query: subject });
      favoriteSubjectToGenre.set(normalized, genre);
    }
  }

  const authorSeeds: RecommendationSeed[] = [];
  const seenAuthorQueries = new Set<string>();
  for (const author of [...recentFocusAuthors, ...favoriteAuthors].slice(0, 5)) {
    const normalized = normalizeToken(author);
    if (!normalized || seenAuthorQueries.has(normalized)) {
      continue;
    }
    seenAuthorQueries.add(normalized);
    authorSeeds.push({ kind: "author", label: author, query: author });
  }

  const genreResults = await Promise.all(
    genreSeeds.map(async (seed) => ({
      seed,
      works: await fetchOpenLibrarySubjectWorks(seed.query, 16)
    }))
  );
  const authorResults = await Promise.all(
    authorSeeds.map(async (seed) => ({
      seed,
      works: await fetchOpenLibraryAuthorWorks(seed.query, 12)
    }))
  );

  const candidates = new Map<string, RecommendationCandidate>();
  for (const result of [...genreResults, ...authorResults]) {
    for (const work of result.works) {
      upsertRecommendationCandidate({
        candidates,
        existingBookKeys,
        work,
        seed: result.seed,
        favoriteSubjectToGenre,
        favoriteGenreSet
      });
    }
  }

  return [...candidates.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, 12)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      author: candidate.author,
      coverUrl: candidate.coverUrl,
      infoUrl: candidate.infoUrl,
      source: "open-library",
      confidence: confidenceFromScore(candidate.score),
      reasons: [...candidate.reasons].slice(0, 3),
      matchedGenres: [...candidate.matchedGenres].slice(0, 4),
      matchedAuthors: [...candidate.matchedAuthors].slice(0, 4)
    }));
}

function buildTrendPoints(groupBy: "day" | "month"): TrendPoint[] {
  const grouped = new Map<string, { totalReadingMs: number; sessions: number; titles: Set<string> }>();

  for (const session of extracted.readingSessions) {
    const key = groupBy === "day" ? toDateKey(session.endTime ?? session.startTime) : toMonthKey(session.endTime ?? session.startTime);
    if (!key) {
      continue;
    }

    const bucket = grouped.get(key) ?? { totalReadingMs: 0, sessions: 0, titles: new Set<string>() };
    bucket.totalReadingMs += session.durationMs;
    bucket.sessions += 1;
    bucket.titles.add(session.bookId);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, bucket]) => ({
      date,
      totalReadingHours: Math.round((bucket.totalReadingMs / 3_600_000) * 10) / 10,
      sessions: bucket.sessions,
      titles: bucket.titles.size
    }));
}

function currentStreak(days: string[]): number {
  const sortedDays = [...new Set(days.map((day) => day.slice(0, 10)))].sort();
  if (sortedDays.length === 0) {
    return 0;
  }

  let streak = 1;
  for (let index = sortedDays.length - 1; index > 0; index -= 1) {
    const current = new Date(`${sortedDays[index]}T00:00:00Z`);
    const previous = new Date(`${sortedDays[index - 1]}T00:00:00Z`);
    const difference = (current.getTime() - previous.getTime()) / 86_400_000;
    if (difference === 1) {
      streak += 1;
      continue;
    }
    break;
  }

  return streak;
}

function longestStreak(days: string[]): number {
  const sortedDays = [...new Set(days.map((day) => day.slice(0, 10)))].sort();
  if (sortedDays.length === 0) {
    return 0;
  }

  let best = 1;
  let current = 1;
  for (let index = 1; index < sortedDays.length; index += 1) {
    const today = new Date(`${sortedDays[index]}T00:00:00Z`);
    const previous = new Date(`${sortedDays[index - 1]}T00:00:00Z`);
    const difference = (today.getTime() - previous.getTime()) / 86_400_000;
    if (difference === 1) {
      current += 1;
      best = Math.max(best, current);
      continue;
    }

    current = 1;
  }

  return best;
}

function lastItems<T>(items: T[], count: number): T[] {
  return items.slice(Math.max(items.length - count, 0));
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMatchValue(value: string | null | undefined): string {
  return transliterateCyrillic(value ?? "")
    .toLowerCase()
    .replace(/\.(azw\d*|mobi|epub|pdf)$/g, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleNeedsRecovery(title: string): boolean {
  const normalized = title.toLowerCase();
  return (
    title === "Untitled" ||
    normalized.includes("libgen") ||
    normalized.includes("avidreaders") ||
    normalized.includes(".azw") ||
    normalized.includes(".epub") ||
    normalized.includes(".mobi")
  );
}

function isNumericPlaceholderTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim();
  if (!trimmed) {
    return false;
  }
  return /^\d{6,10}$/.test(trimmed);
}

function normalizeIsbnDigits(value: string): string {
  return value.replace(/[^0-9X]/gi, "").toUpperCase();
}

function isbn10ToIsbn13(isbn10: string): string | null {
  const core = normalizeIsbnDigits(isbn10);
  if (core.length !== 10) {
    return null;
  }

  const body = core.slice(0, 9);
  if (!/^\d{9}$/.test(body)) {
    return null;
  }

  const prefix = `978${body}`;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(prefix[index]) * (index % 2 === 0 ? 1 : 3);
  }

  const check = (10 - (sum % 10)) % 10;
  return `${prefix}${check}`;
}

function isbnVariants(raw: string): string[] {
  const digits = normalizeIsbnDigits(raw);
  const variants: string[] = [];
  if (digits.length === 10) {
    variants.push(digits);
    const as13 = isbn10ToIsbn13(digits);
    if (as13) {
      variants.push(as13);
    }
  } else if (digits.length === 13) {
    variants.push(digits);
  } else if (digits.length > 0) {
    variants.push(digits);
  }

  return [...new Set(variants)];
}

async function openLibraryImageMeaningfulBytes(url: string, minBytes: number): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      return false;
    }

    const buffer = await response.arrayBuffer();
    return buffer.byteLength >= minBytes;
  } catch {
    return false;
  }
}

async function tryOpenLibraryIsbnCover(isbn: string): Promise<string | null> {
  for (const variant of isbnVariants(isbn)) {
    const url = `https://covers.openlibrary.org/b/isbn/${variant}-L.jpg?default=false`;
    if (await openLibraryImageMeaningfulBytes(url, 4000)) {
      return url;
    }
  }

  const compact = normalizeIsbnDigits(isbn);
  if (!compact) {
    return null;
  }

  const searchPayload = await fetchJsonWithRetries<{
    docs?: Array<{ cover_i?: number }>;
  }>(`https://openlibrary.org/search.json?q=isbn:${encodeURIComponent(compact)}&limit=5`);
  if (!searchPayload) {
    return null;
  }

  for (const doc of searchPayload.docs ?? []) {
    if (!doc.cover_i) {
      continue;
    }

    const url = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`;
    if (await openLibraryImageMeaningfulBytes(url, 4000)) {
      return url;
    }
  }

  return null;
}

function extractGoogleIsbn(
  identifiers: Array<{ type?: string; identifier?: string }> | undefined
): string | null {
  const match = identifiers?.find((identifier) => /^ISBN_/.test(identifier.type ?? ""));
  return match?.identifier ?? null;
}

async function fetchGoogleVolumeImageLinks(volumeId: string): Promise<Record<string, string> | undefined> {
  const payload = await fetchJsonWithRetries<{
    volumeInfo?: { imageLinks?: Record<string, string> };
  }>(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(volumeId)}`, 1);
  if (!payload) {
    return undefined;
  }
  return payload.volumeInfo?.imageLinks;
}

async function fetchGoogleBooksMetadata(book: NormalizedBook): Promise<Partial<BookMetadataCacheEntry> | null> {
  const hasRecoverableTitle = book.title !== "Untitled";
  const numericPlaceholder = isNumericPlaceholderTitle(book.title);
  const transliteratedTitle = transliterateCyrillic(book.title).trim();
  const transliteratedAuthor = transliterateCyrillic(book.authors[0] ?? "").trim();
  const useIntitle =
    hasRecoverableTitle && !numericPlaceholder && !titleNeedsRecovery(book.title);
  const titleQuery = useIntitle ? `intitle:${book.title}` : "";
  const authorQuery = book.authors[0] ? `inauthor:${book.authors[0]}` : "";
  const transliteratedScopedQuery =
    [transliteratedTitle ? `intitle:${transliteratedTitle}` : "", transliteratedAuthor ? `inauthor:${transliteratedAuthor}` : ""]
      .filter(Boolean)
      .join(" ");
  const queryCandidates = [
    book.isbn ? `isbn:${book.isbn}` : "",
    [titleQuery, authorQuery, book.asin ?? ""].filter(Boolean).join(" "),
    [book.title, book.authors[0] ?? "", book.asin ?? ""].filter(Boolean).join(" "),
    transliteratedScopedQuery,
    [transliteratedTitle, transliteratedAuthor].filter(Boolean).join(" "),
    transliteratedTitle,
    transliteratedAuthor,
    book.title,
    book.authors[0] ?? "",
    book.asin ?? ""
  ];
  const queries = [...new Set(queryCandidates.map((entry) => entry.trim()).filter(Boolean))].slice(0, 6);
  if (queries.length === 0) {
    return null;
  }

  const items: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      authors?: string[];
      imageLinks?: Record<string, string>;
      industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    };
  }> = [];
  const seenIds = new Set<string>();
  for (const query of queries) {
    const payload = await fetchJsonWithRetries<{
      items?: Array<{
        id?: string;
        volumeInfo?: {
          title?: string;
          authors?: string[];
          imageLinks?: Record<string, string>;
          industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
        };
      }>;
    }>(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`, 1);
    for (const item of payload?.items ?? []) {
      const id = item.id ?? `${item.volumeInfo?.title ?? ""}-${item.volumeInfo?.authors?.[0] ?? ""}`;
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      items.push(item);
      if (items.length >= 12) {
        break;
      }
    }
    if (items.length >= 12) {
      break;
    }
  }
  if (items.length === 0) {
    return null;
  }

  const normalizedBookTitle = numericPlaceholder ? "" : normalizeMatchValue(book.title);
  const normalizedBookAuthor = normalizeMatchValue(book.authors[0] ?? "");

  let bestMatch:
    | {
        score: number;
        volumeId: string | null;
        title: string | null;
        authors: string[];
        coverUrl: string | null;
        isbn: string | null;
      }
    | null = null;

  for (const item of items) {
    const info = item.volumeInfo;
    if (!info?.title) {
      continue;
    }

    const candidateTitle = normalizeMatchValue(info.title);
    const candidateAuthor = normalizeMatchValue(info.authors?.[0] ?? "");
    let score = 0;

    if (book.isbn && extractGoogleIsbn(info.industryIdentifiers) === book.isbn) {
      score += 20;
    }

    if (numericPlaceholder && normalizedBookAuthor && candidateAuthor) {
      if (candidateAuthor === normalizedBookAuthor) {
        score += 14;
      } else if (
        candidateAuthor.includes(normalizedBookAuthor) ||
        normalizedBookAuthor.includes(candidateAuthor)
      ) {
        score += 9;
      }
    }

    if (normalizedBookTitle && candidateTitle) {
      if (candidateTitle === normalizedBookTitle) {
        score += 12;
      } else if (
        candidateTitle.includes(normalizedBookTitle) ||
        normalizedBookTitle.includes(candidateTitle)
      ) {
        score += 7;
      }
    }

    if (normalizedBookAuthor && candidateAuthor) {
      if (candidateAuthor === normalizedBookAuthor) {
        score += 6;
      } else if (
        candidateAuthor.includes(normalizedBookAuthor) ||
        normalizedBookAuthor.includes(candidateAuthor)
      ) {
        score += 4;
      }
    }

    if (pickBestGoogleBooksImageLink(info.imageLinks)) {
      score += 1;
    }

    if (titleNeedsRecovery(book.title) && info.title) {
      score += 2;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        score,
        volumeId: item.id ?? null,
        title: info.title ?? null,
        authors: info.authors ?? [],
        coverUrl: pickBestGoogleBooksImageLink(info.imageLinks),
        isbn: extractGoogleIsbn(info.industryIdentifiers)
      };
    }
  }

  const minGoogleScore = bestMatch?.coverUrl ? 4 : 6;
  if (!bestMatch || bestMatch.score < minGoogleScore) {
    return null;
  }

  let coverUrl = bestMatch.coverUrl;
  if (bestMatch.volumeId) {
    const volumeLinks = await fetchGoogleVolumeImageLinks(bestMatch.volumeId);
    const fromVolume = pickBestGoogleBooksImageLink(volumeLinks);
    if (fromVolume) {
      coverUrl = fromVolume;
    }
  }

  if (isGoogleBooksPlaceholderVolumeCoverUrl(coverUrl)) {
    coverUrl = null;
  }

  return {
    title: bestMatch.title,
    authors: bestMatch.authors,
    coverUrl,
    coverSource: coverUrl ? "google-books" : null,
    isbn: bestMatch.isbn ?? book.isbn
  };
}

async function fetchOpenLibraryMetadata(book: NormalizedBook): Promise<Partial<BookMetadataCacheEntry> | null> {
  let isbnCover: string | null = null;
  let normalizedIsbn: string | null = null;
  if (book.isbn) {
    normalizedIsbn = normalizeIsbnDigits(book.isbn);
    if (normalizedIsbn) {
      isbnCover = await tryOpenLibraryIsbnCover(book.isbn);
    }
  }

  if ((titleNeedsRecovery(book.title) || !book.title) && !isNumericPlaceholderTitle(book.title)) {
    if (!isbnCover) {
      return null;
    }

    return {
      coverUrl: isbnCover,
      coverSource: "open-library",
      isbn: normalizedIsbn ?? book.isbn
    };
  }

  const numericPlaceholder = isNumericPlaceholderTitle(book.title);
  const transliteratedTitle = transliterateCyrillic(book.title).trim();
  const transliteratedAuthor = transliterateCyrillic(book.authors[0] ?? "").trim();
  const queryCandidates = numericPlaceholder
    ? [(book.authors[0] ?? "").trim(), transliteratedAuthor]
    : [
        [book.title, book.authors[0] ?? ""].filter(Boolean).join(" ").trim(),
        book.title.trim(),
        (book.authors[0] ?? "").trim(),
        [transliteratedTitle, transliteratedAuthor].filter(Boolean).join(" ").trim(),
        transliteratedTitle,
        transliteratedAuthor
      ];
  const queries = [...new Set(queryCandidates.filter(Boolean))].slice(0, 6);
  if (queries.length === 0) {
    if (!isbnCover) {
      return null;
    }

    return {
      coverUrl: isbnCover,
      coverSource: "open-library",
      isbn: normalizedIsbn ?? book.isbn
    };
  }
  const docs: Array<{
    title?: string;
    author_name?: string[];
    isbn?: string[];
    cover_i?: number;
  }> = [];
  const seenDocKeys = new Set<string>();
  for (const query of queries) {
    const payload = await fetchJsonWithRetries<{
      docs?: Array<{
        title?: string;
        author_name?: string[];
        isbn?: string[];
        cover_i?: number;
      }>;
    }>(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`);
    for (const doc of payload?.docs ?? []) {
      const key = `${normalizeMatchValue(doc.title ?? "")}::${normalizeMatchValue(doc.author_name?.[0] ?? "")}`;
      if (!key || seenDocKeys.has(key)) {
        continue;
      }
      seenDocKeys.add(key);
      docs.push(doc);
      if (docs.length >= 12) {
        break;
      }
    }
    if (docs.length >= 12) {
      break;
    }
  }
  if (docs.length === 0 && !isbnCover) {
    return null;
  }
  if (docs.length === 0) {
    return {
      coverUrl: isbnCover,
      coverSource: "open-library",
      isbn: normalizedIsbn ?? book.isbn
    };
  }

  const normalizedBookTitle = numericPlaceholder ? "" : normalizeMatchValue(book.title);
  const normalizedBookAuthor = normalizeMatchValue(book.authors[0] ?? "");

  let bestMatch:
    | {
        score: number;
        title: string | null;
        authors: string[];
        isbn: string | null;
        coverUrl: string | null;
      }
    | null = null;

  for (const doc of docs) {
    const candidateTitle = normalizeMatchValue(doc.title ?? "");
    const candidateAuthor = normalizeMatchValue(doc.author_name?.[0] ?? "");
    let score = 0;

    if (numericPlaceholder && normalizedBookAuthor && candidateAuthor) {
      if (candidateAuthor === normalizedBookAuthor) {
        score += 12;
      } else if (
        candidateAuthor.includes(normalizedBookAuthor) ||
        normalizedBookAuthor.includes(candidateAuthor)
      ) {
        score += 8;
      }
    }

    if (normalizedBookTitle && candidateTitle === normalizedBookTitle) {
      score += 10;
    } else if (
      normalizedBookTitle &&
      (candidateTitle.includes(normalizedBookTitle) || normalizedBookTitle.includes(candidateTitle))
    ) {
      score += 6;
    }

    if (normalizedBookAuthor && candidateAuthor) {
      if (candidateAuthor === normalizedBookAuthor) {
        score += 5;
      } else if (
        candidateAuthor.includes(normalizedBookAuthor) ||
        normalizedBookAuthor.includes(candidateAuthor)
      ) {
        score += 3;
      }
    }

    if (doc.cover_i) {
      score += 6;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        score,
        title: doc.title ?? null,
        authors: doc.author_name ?? [],
        isbn: doc.isbn?.[0] ?? null,
        coverUrl: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`
          : null
      };
    }
  }

  const minOpenLibraryScore = bestMatch?.coverUrl ? 4 : 6;
  if (!bestMatch || bestMatch.score < minOpenLibraryScore) {
    if (!isbnCover) {
      return null;
    }

    return {
      coverUrl: isbnCover,
      coverSource: "open-library",
      isbn: normalizedIsbn ?? book.isbn
    };
  }

  let coverUrl = bestMatch.coverUrl;
  if (
    coverUrl &&
    !(await openLibraryImageMeaningfulBytes(coverUrl, 4000))
  ) {
    coverUrl = null;
  }

  if (!coverUrl && isbnCover) {
    coverUrl = isbnCover;
  }

  return {
    title: bestMatch.title,
    authors: bestMatch.authors,
    isbn: bestMatch.isbn ?? normalizedIsbn ?? book.isbn,
    coverUrl,
    coverSource: coverUrl ? "open-library" : null
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

const sessionTotals = new Map<string, { totalReadingMs: number; sessionCount: number; lastReadAt: string | null }>();
for (const session of extracted.readingSessions) {
  const bucket = sessionTotals.get(session.bookId) ?? {
    totalReadingMs: 0,
    sessionCount: 0,
    lastReadAt: null
  };
  bucket.totalReadingMs += session.durationMs;
  bucket.sessionCount += 1;
  bucket.lastReadAt =
    [bucket.lastReadAt, session.endTime, session.startTime].filter(Boolean).sort().at(-1) ?? bucket.lastReadAt;
  sessionTotals.set(session.bookId, bucket);
}

const completionTotals = new Map<string, number>();
for (const completion of extracted.completions) {
  completionTotals.set(completion.bookId, (completionTotals.get(completion.bookId) ?? 0) + 1);
}

const annotationTotals = new Map<
  string,
  { annotationCount: number; noteCount: number; highlightCount: number; lastAnnotatedAt: string | null }
>();
for (const annotation of extracted.annotations) {
  const bucket = annotationTotals.get(annotation.bookId) ?? {
    annotationCount: 0,
    noteCount: 0,
    highlightCount: 0,
    lastAnnotatedAt: null
  };
  bucket.annotationCount += 1;
  bucket.noteCount += annotation.noteCount;
  bucket.highlightCount += annotation.highlightCount;
  bucket.lastAnnotatedAt =
    [bucket.lastAnnotatedAt, annotation.lastUpdatedAt].filter(Boolean).sort().at(-1) ?? bucket.lastAnnotatedAt;
  annotationTotals.set(annotation.bookId, bucket);
}

const ownedBooks = new Set(
  extracted.ownership
    .filter((entry) => entry.rightStatus === "Active" || entry.rightType === "Download")
    .map((entry) => entry.bookId)
);

const booksByAsin = new Map(
  extracted.books
    .filter((book) => Boolean(book.asin))
    .map((book) => [book.asin as string, book.id])
);

const recommendationCounts = new Map<string, { viewCount: number; clickCount: number }>();
let recommendationViews = 0;
let recommendationClicks = 0;

for (const event of extracted.recommendationEvents) {
  if (event.kind === "view") {
    recommendationViews += 1;
  } else {
    recommendationClicks += 1;
  }

  if (!event.asin) {
    continue;
  }

  const bookId = booksByAsin.get(event.asin);
  if (!bookId) {
    continue;
  }

  const bucket = recommendationCounts.get(bookId) ?? { viewCount: 0, clickCount: 0 };
  if (event.kind === "view") {
    bucket.viewCount += 1;
  } else {
    bucket.clickCount += 1;
  }
  recommendationCounts.set(bookId, bucket);
}

const overrides = await readJsonIfExists<BookOverrides>(overridesPath, { byBookId: {} });
const metadataCache = await readJsonIfExists<Record<string, BookMetadataCacheEntry>>(metadataCachePath, {});
const goodreadsAsinCache = await readJsonIfExists<GoodreadsAsinCache>(goodreadsAsinCachePath, {});

const prioritizedBooks = extracted.books
  .map((book) => ({
    ...book,
    priority:
      (sessionTotals.get(book.id)?.totalReadingMs ?? 0) +
      (completionTotals.get(book.id) ?? 0) * 3_600_000 +
      (recommendationCounts.get(book.id)?.clickCount ?? 0) * 1_800_000
  }))
  .sort((left, right) => right.priority - left.priority);

async function resolveMetadataForBook(book: NormalizedBook): Promise<BookMetadataCacheEntry | null> {
  const hinted = mergeKindleAsinTitleHint(book, goodreadsAsinCache);
  const override = overrides.byBookId[hinted.id];
  const cached = metadataCache[hinted.id];

  const baseRecord: BookMetadataCacheEntry = {
    title: override?.title ?? cached?.title ?? hinted.title,
    authors: override?.authors ?? cached?.authors ?? hinted.authors,
    coverUrl: override?.coverUrl ?? cached?.coverUrl ?? hinted.coverUrl,
    coverSource: override?.coverSource ?? cached?.coverSource ?? hinted.coverSource,
    isbn: override?.isbn ?? cached?.isbn ?? hinted.isbn,
    updatedAt: new Date().toISOString()
  };
  const stableTitle = override?.title ?? book.title;
  const stableAuthors = override?.authors ?? book.authors;

  const needsTitleRecovery =
    titleNeedsRecovery(stableTitle) ||
    isNumericPlaceholderTitle(stableTitle);
  const needsCover =
    !baseRecord.coverUrl || isGoogleBooksPlaceholderVolumeCoverUrl(baseRecord.coverUrl);

  if (!needsTitleRecovery && !needsCover) {
    return {
      ...baseRecord,
      title: stableTitle,
      authors: stableAuthors
    };
  }

  let google: Partial<BookMetadataCacheEntry> | null = null;
  try {
    google = await fetchGoogleBooksMetadata({
      ...hinted,
      title: baseRecord.title ?? hinted.title,
      authors: baseRecord.authors,
      isbn: baseRecord.isbn,
      coverUrl: baseRecord.coverUrl,
      coverSource: baseRecord.coverSource
    });
  } catch {
    google = null;
  }

  const mergedGoogleRaw = {
    ...baseRecord,
    ...google,
    authors: google?.authors ?? baseRecord.authors
  };

  const mergedGoogle = isGoogleBooksPlaceholderVolumeCoverUrl(mergedGoogleRaw.coverUrl)
    ? { ...mergedGoogleRaw, coverUrl: null, coverSource: null }
    : mergedGoogleRaw;

  if (
    !mergedGoogle.coverUrl ||
    titleNeedsRecovery(mergedGoogle.title ?? hinted.title) ||
    isNumericPlaceholderTitle(mergedGoogle.title ?? hinted.title)
  ) {
    let openLibrary: Partial<BookMetadataCacheEntry> | null = null;
    try {
      openLibrary = await fetchOpenLibraryMetadata({
        ...hinted,
        title: mergedGoogle.title ?? hinted.title,
        authors: mergedGoogle.authors,
        isbn: mergedGoogle.isbn,
        coverUrl: mergedGoogle.coverUrl,
        coverSource: mergedGoogle.coverSource
      });
    } catch {
      openLibrary = null;
    }

    return {
      ...mergedGoogle,
      ...openLibrary,
      title: needsTitleRecovery ? (openLibrary?.title ?? mergedGoogle.title ?? stableTitle) : stableTitle,
      authors: needsTitleRecovery ? (openLibrary?.authors ?? mergedGoogle.authors ?? stableAuthors) : stableAuthors,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    ...mergedGoogle,
    title: needsTitleRecovery ? (mergedGoogle.title ?? stableTitle) : stableTitle,
    authors: needsTitleRecovery ? (mergedGoogle.authors ?? stableAuthors) : stableAuthors,
    updatedAt: new Date().toISOString()
  };
}

const resolvedMetadataEntries = await mapWithConcurrency(
  prioritizedBooks,
  8,
  async (entry) => {
    const { priority: _priority, ...book } = entry as NormalizedBook & { priority: number };
    return [book.id, await resolveMetadataForBook(book)] as const;
  }
);

for (const [bookId, metadata] of resolvedMetadataEntries) {
  if (metadata) {
    metadataCache[bookId] = metadata;
  }
}

writeProcessedJson(metadataCachePath, metadataCache);

const resolvedBooks: NormalizedBook[] = extracted.books.map((book) => {
  const hinted = mergeKindleAsinTitleHint(book, goodreadsAsinCache);
  const metadata = metadataCache[book.id];
  const authors =
    overrides.byBookId[book.id]?.authors ??
    normalizeAuthors(metadata?.authors && metadata.authors.length > 0 ? metadata.authors : hinted.authors);
  return {
    ...book,
    title:
      overrides.byBookId[book.id]?.title ??
      cleanDisplayTitle(metadata?.title && !titleNeedsRecovery(metadata.title) ? metadata.title : hinted.title, authors),
    authors,
    isbn: overrides.byBookId[book.id]?.isbn ?? metadata?.isbn ?? book.isbn,
    coverUrl: overrides.byBookId[book.id]?.coverUrl ?? metadata?.coverUrl ?? book.coverUrl,
    coverSource: overrides.byBookId[book.id]?.coverSource ?? metadata?.coverSource ?? book.coverSource
  };
});

const enrichedBooks: EnrichedBook[] = resolvedBooks.map((book) => {
  const session = sessionTotals.get(book.id);
  const completionCount = completionTotals.get(book.id) ?? 0;
  const annotation = annotationTotals.get(book.id);
  const recommendation = recommendationCounts.get(book.id);
  const coverUrl = upgradeCoverImageUrl(book.coverUrl) ?? book.coverUrl;

  return {
    ...book,
    coverUrl,
    totalReadingMs: session?.totalReadingMs ?? 0,
    sessionCount: session?.sessionCount ?? 0,
    completionCount,
    annotationCount: annotation?.annotationCount ?? 0,
    noteCount: annotation?.noteCount ?? 0,
    highlightCount: annotation?.highlightCount ?? 0,
    lastReadAt: session?.lastReadAt ?? null,
    lastAnnotatedAt: annotation?.lastAnnotatedAt ?? null,
    recommendationViewCount: recommendation?.viewCount ?? 0,
    recommendationClickCount: recommendation?.clickCount ?? 0,
    isOwned: ownedBooks.has(book.id)
  };
});
const enrichedBooksById = new Map(enrichedBooks.map((book) => [book.id, book]));

// The dashboard UI reads this one file: aggregates in the reader's time zone, with no session timestamps.
const readingTimeZone = process.env.READING_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

// Overrides can fold duplicates into one book (sameAs, followed transitively) or drop non-books (exclude).
const canonicalIds = new Map<string, string | null>();
for (const [bookId, override] of Object.entries(overrides.byBookId)) {
  if (override.exclude) {
    canonicalIds.set(bookId, null);
  } else if (override.sameAs) {
    let target = override.sameAs;
    const visited = new Set([bookId]);
    while (overrides.byBookId[target]?.sameAs && !visited.has(target)) {
      visited.add(target);
      target = overrides.byBookId[target].sameAs!;
    }
    // A duplicate of an excluded book is excluded with it.
    canonicalIds.set(bookId, overrides.byBookId[target]?.exclude ? null : target);
  }
}
const readingDatasetJson = JSON.stringify(
  buildReadingDataset({
    books: enrichedBooks.map((book) => ({ ...book, coverUrl: resolveCoverImageUrlForDisplay(book.coverUrl) })),
    sessions: extracted.readingSessions,
    completions: extracted.completions,
    annotations: extracted.annotations,
    timeZone: readingTimeZone,
    canonicalIds,
    unlistedIds: new Set(
      Object.entries(overrides.byBookId)
        .filter(([, override]) => override.listed === false)
        .map(([bookId]) => bookId)
    ),
    notFinishedIds: new Set(
      Object.entries(overrides.byBookId)
        .filter(([, override]) => override.finished === false)
        .map(([bookId]) => bookId)
    )
  })
);
Bun.write(join(processedDir, "reading.json"), readingDatasetJson);
Bun.write(join(publicProcessedDir, "reading.json"), readingDatasetJson);
const analyticsEligibleBookIds = new Set(
  enrichedBooks
    .filter((book) => book.totalReadingMs > 0 || book.completionCount > 0 || book.isOwned)
    .map((book) => book.id)
);
const analyticsEligibleBooks = enrichedBooks.filter((book) => analyticsEligibleBookIds.has(book.id));

const dailyTrend = buildTrendPoints("day");
const monthlyTrend = buildTrendPoints("month");
const totalReadingMs = extracted.readingSessions.reduce((sum, session) => sum + session.durationMs, 0);
const totalReadingHours = totalReadingMs / 3_600_000;
const totalNoteCount = extracted.annotations.reduce((sum, annotation) => sum + annotation.noteCount, 0);
const totalHighlightCount = extracted.annotations.reduce((sum, annotation) => sum + annotation.highlightCount, 0);
const currentStreakDays = currentStreak(extracted.readingTrackedDays);
const longestStreakDays = longestStreak(extracted.readingTrackedDays);
const averageSessionMinutes =
  extracted.readingSessions.length > 0 ? totalReadingMs / extracted.readingSessions.length / 60_000 : 0;
const completedBooks = new Set(extracted.completions.map((completion) => completion.bookId)).size;
const activeDays = new Set(extracted.readingTrackedDays.map((day) => day.slice(0, 10))).size || dailyTrend.length;
const latestTrackedDay = [...extracted.readingTrackedDays].sort().at(-1) ?? null;
const referenceYear = latestTrackedDay ? new Date(latestTrackedDay).getUTCFullYear() : new Date().getUTCFullYear();
const currentYearReadingMs = extracted.readingSessions.reduce((sum, session) => {
  const timestamp = session.endTime ?? session.startTime;
  if (!timestamp || new Date(timestamp).getUTCFullYear() !== referenceYear) {
    return sum;
  }

  return sum + session.durationMs;
}, 0);

const authorMap = new Map<string, number>();
const authorDetailMap = new Map<string, string>();
const genreMap = new Map<string, number>();
const seriesMap = new Map<string, number>();
const topBookMap = new Map<string, number>();
const formatMap = new Map<string, number>();
const weekdayMap = new Map<string, number>();
const daypartMap = new Map<string, number>();

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toDaypart(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return "Morning";
  }
  if (hour >= 12 && hour < 17) {
    return "Afternoon";
  }
  if (hour >= 17 && hour < 22) {
    return "Evening";
  }
  return "Night";
}

for (const session of extracted.readingSessions) {
  const timestamp = session.startTime ?? session.endTime;
  if (!timestamp) {
    continue;
  }

  const date = new Date(timestamp);
  const weekday = weekdayNames[date.getUTCDay()];
  const daypart = toDaypart(date.getUTCHours());
  weekdayMap.set(weekday, (weekdayMap.get(weekday) ?? 0) + session.durationMs);
  daypartMap.set(daypart, (daypartMap.get(daypart) ?? 0) + session.durationMs);
}

for (const book of analyticsEligibleBooks) {
  const weight = book.totalReadingMs / 3_600_000 + book.completionCount * 2 + book.annotationCount * 0.1;
  if (weight <= 0) {
    continue;
  }

  for (const author of book.authors) {
    authorMap.set(author, (authorMap.get(author) ?? 0) + weight);
    authorDetailMap.set(author, `${book.completionCount} completed / ${formatHours(book.totalReadingMs / 3_600_000)}`);
  }

  for (const genre of book.genres) {
    genreMap.set(genre, (genreMap.get(genre) ?? 0) + weight);
  }

  if (book.seriesTitle) {
    seriesMap.set(book.seriesTitle, (seriesMap.get(book.seriesTitle) ?? 0) + weight);
  }

  if (book.title !== "Untitled") {
    topBookMap.set(book.title, (topBookMap.get(book.title) ?? 0) + book.totalReadingMs / 3_600_000);
  }

  const format = book.isPersonalDocument ? "Personal document" : book.contentType ?? book.resourceType ?? "E-Book";
  formatMap.set(format, (formatMap.get(format) ?? 0) + weight);
}

const recommendations = recommendBooks(
  enrichedBooks
    .filter((book) => book.title !== "Untitled" || book.totalReadingMs > 0 || book.isOwned)
    .sort((left, right) => right.totalReadingMs - left.totalReadingMs)
);

const currentPeriodChart = lastItems(dailyTrend, 31);
const currentPeriodHours = currentPeriodChart.reduce((sum, point) => sum + point.totalReadingHours, 0);

const genreShares: GenreShare[] = [...genreMap.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 3)
  .map(([name, value], _index, array) => {
    const total = array.reduce((sum, [, currentValue]) => sum + currentValue, 0);
    return {
      name,
      share: total > 0 ? Math.round((value / total) * 100) : 0
    };
  });

const favoriteWeekday =
  [...weekdayMap.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Sunday";
const favoriteDaypart =
  [...daypartMap.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Evening";

const daypartWindows: Record<string, string> = {
  Morning: "06:00 - 11:00",
  Afternoon: "12:00 - 17:00",
  Evening: "18:00 - 22:00",
  Night: "22:00 - 01:00"
};

const daypartShares: DaypartShare[] = ["Morning", "Afternoon", "Evening", "Night"].map((name) => {
  const total = [...daypartMap.values()].reduce((sum, value) => sum + value, 0);
  const share = total > 0 ? Math.round(((daypartMap.get(name) ?? 0) / total) * 100) : 0;
  return {
    name,
    share,
    detail: daypartWindows[name]
  };
});

const milestones: ReadingMilestones = {
  currentStreak: currentStreakDays,
  longestStreak: longestStreakDays,
  activeDays
};

const referenceTimestamp =
  Math.max(
    parseTimestamp(latestTrackedDay),
    ...extracted.readingSessions.map((session) => parseTimestamp(session.endTime ?? session.startTime)),
    ...extracted.mostRecentPageReadEvents.map((event) => parseTimestamp(event.createdAt)),
    ...extracted.bookOpenEvents.map((event) => parseTimestamp(event.createdAt))
  ) || Date.now();

const unfinishedBooks = enrichedBooks.filter((book) => book.title !== "Untitled" && book.totalReadingMs > 0 && book.completionCount === 0);
const latestSignalByBook = new Map<string, number>();
for (const event of extracted.mostRecentPageReadEvents) {
  if (!event.bookId) {
    continue;
  }
  latestSignalByBook.set(event.bookId, Math.max(latestSignalByBook.get(event.bookId) ?? 0, parseTimestamp(event.createdAt)));
}
for (const event of extracted.bookOpenEvents) {
  if (!event.bookId) {
    continue;
  }
  latestSignalByBook.set(event.bookId, Math.max(latestSignalByBook.get(event.bookId) ?? 0, parseTimestamp(event.createdAt)));
}

const recentReadingMsByBook = new Map<string, number>();
const daypartMsByBook = new Map<string, Map<string, number>>();
const weeklyActiveBookBuckets = new Map<string, Set<string>>();
const sessionTimesByBook = new Map<string, number[]>();
const parallelWindowStart = referenceTimestamp - 84 * 86_400_000;
for (const session of extracted.readingSessions) {
  const timestamp = parseTimestamp(session.endTime ?? session.startTime);
  if (!timestamp) {
    continue;
  }

  const bucket = sessionTimesByBook.get(session.bookId) ?? [];
  bucket.push(timestamp);
  sessionTimesByBook.set(session.bookId, bucket);

  const book = enrichedBooksById.get(session.bookId);
  if (!book || book.completionCount > 0 || book.title === "Untitled") {
    continue;
  }

  const sessionDate = new Date(timestamp);
  const daypart = toDaypart(sessionDate.getUTCHours());
  const daypartBucket = daypartMsByBook.get(session.bookId) ?? new Map<string, number>();
  daypartBucket.set(daypart, (daypartBucket.get(daypart) ?? 0) + session.durationMs);
  daypartMsByBook.set(session.bookId, daypartBucket);

  if (timestamp >= referenceTimestamp - 30 * 86_400_000) {
    recentReadingMsByBook.set(session.bookId, (recentReadingMsByBook.get(session.bookId) ?? 0) + session.durationMs);
  }

  if (timestamp >= parallelWindowStart) {
    const weekStart = new Date(timestamp);
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    const set = weeklyActiveBookBuckets.get(key) ?? new Set<string>();
    set.add(session.bookId);
    weeklyActiveBookBuckets.set(key, set);
  }
}

function contextChipForBook(bookId: string): string {
  const ranked = [...(daypartMsByBook.get(bookId) ?? new Map()).entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (ranked === "Morning") {
    return "Morning Ritual";
  }
  if (ranked === "Afternoon") {
    return "Deep Work";
  }
  if (ranked === "Evening") {
    return "Evening Unwind";
  }
  if (ranked === "Night") {
    return "Before Bed";
  }
  return "Recent Focus";
}

const weeklyParallelChart: ParallelReadingPoint[] = [];
for (let index = 11; index >= 0; index -= 1) {
  const timestamp = referenceTimestamp - index * 7 * 86_400_000;
  const weekStart = new Date(timestamp);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const key = weekStart.toISOString().slice(0, 10);
  weeklyParallelChart.push({
    date: key,
    activeBooks: weeklyActiveBookBuckets.get(key)?.size ?? 0,
    smoothedActiveBooks: 0
  });
}
for (let index = 0; index < weeklyParallelChart.length; index += 1) {
  const window = weeklyParallelChart.slice(Math.max(0, index - 1), Math.min(weeklyParallelChart.length, index + 2));
  const average = window.reduce((sum, point) => sum + point.activeBooks, 0) / Math.max(window.length, 1);
  weeklyParallelChart[index].smoothedActiveBooks = Math.round(average * 10) / 10;
}

const concurrencyIndex =
  weeklyParallelChart.length > 0
    ? Math.round((weeklyParallelChart.reduce((sum, point) => sum + point.activeBooks, 0) / weeklyParallelChart.length) * 10) / 10
    : 0;
const peakConcurrentBooks = Math.max(...weeklyParallelChart.map((point) => point.activeBooks), 0);

const unfinishedBySignal = [...unfinishedBooks].sort((left, right) => {
  const bySignal = (latestSignalByBook.get(right.id) ?? 0) - (latestSignalByBook.get(left.id) ?? 0);
  if (bySignal !== 0) {
    return bySignal;
  }
  const byLastRead = parseTimestamp(right.lastReadAt) - parseTimestamp(left.lastReadAt);
  if (byLastRead !== 0) {
    return byLastRead;
  }
  return right.totalReadingMs - left.totalReadingMs;
});

const staleCandidate = unfinishedBooks
  .filter((book) => {
    const days = Math.floor((referenceTimestamp - parseTimestamp(book.lastReadAt)) / 86_400_000);
    return days >= 21 && book.totalReadingMs >= 3 * 3_600_000;
  })
  .sort((left, right) => parseTimestamp(left.lastReadAt) - parseTimestamp(right.lastReadAt))[0];

const activeParallelSource = unfinishedBySignal.slice(0, 3);
const activeParallelBooks = [...activeParallelSource];
if (staleCandidate && !activeParallelBooks.some((book) => book.id === staleCandidate.id)) {
  if (activeParallelBooks.length < 3) {
    activeParallelBooks.push(staleCandidate);
  } else {
    activeParallelBooks[activeParallelBooks.length - 1] = staleCandidate;
  }
}

const maxRecentReadingMs = Math.max(...activeParallelBooks.map((book) => recentReadingMsByBook.get(book.id) ?? book.totalReadingMs), 1);
const parallelActiveBooks: ParallelReadingBook[] = activeParallelBooks
  .filter(Boolean)
  .map((book) => {
    const daysSinceLastRead =
      book.lastReadAt ? Math.max(0, Math.floor((referenceTimestamp - parseTimestamp(book.lastReadAt)) / 86_400_000)) : null;
    const recentMs = recentReadingMsByBook.get(book.id) ?? book.totalReadingMs;
    return {
      bookId: book.id,
      title: book.title,
      author: book.authors[0] ?? "Unknown author",
      coverUrl: book.coverUrl,
      contextLabel: contextChipForBook(book.id),
      daysSinceLastRead,
      stalled: Boolean(daysSinceLastRead !== null && daysSinceLastRead >= 21),
      activityShare: Math.max(14, Math.round((recentMs / maxRecentReadingMs) * 100))
    };
  });

let pausedBooks = 0;
let resumedBooks = 0;
for (const book of enrichedBooks) {
  const times = [...(sessionTimesByBook.get(book.id) ?? [])].sort((left, right) => left - right);
  if (times.length === 0) {
    continue;
  }

  let hasCurrentPause = referenceTimestamp - times[times.length - 1] >= 21 * 86_400_000;
  let hasHistoricalResume = false;
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - times[index - 1] >= 21 * 86_400_000) {
      hasHistoricalResume = true;
      break;
    }
  }

  if (hasHistoricalResume || hasCurrentPause) {
    pausedBooks += 1;
  }
  if (hasHistoricalResume) {
    resumedBooks += 1;
  }
}

const resumptionRate = pausedBooks > 0 ? Math.round((resumedBooks / pausedBooks) * 100) : 0;
const abandonmentRiskCount = unfinishedBooks.filter((book) => {
  const days = Math.floor((referenceTimestamp - parseTimestamp(book.lastReadAt)) / 86_400_000);
  return days >= 21 && book.totalReadingMs >= 3 * 3_600_000;
}).length;

const parallelReading: ParallelReadingSummary = {
  concurrencyIndex,
  peakConcurrentBooks,
  chart: weeklyParallelChart,
  activeBooks: parallelActiveBooks,
  resumptionRate,
  abandonmentRiskCount
};

const favoriteGenresForApi = [...genreMap.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 4)
  .map(([name]) => name);
const favoriteAuthorsForApi = [...authorMap.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 4)
  .map(([name]) => name);
const recentFocusAuthors = enrichedBooks
  .filter((book) => {
    if (book.totalReadingMs <= 0) {
      return false;
    }
    const lastRead = parseTimestamp(book.lastReadAt);
    if (!lastRead) {
      return false;
    }
    return referenceTimestamp - lastRead <= 75 * 86_400_000;
  })
  .sort((left, right) => {
    const leftLastRead = parseTimestamp(left.lastReadAt);
    const rightLastRead = parseTimestamp(right.lastReadAt);
    if (rightLastRead !== leftLastRead) {
      return rightLastRead - leftLastRead;
    }
    return right.totalReadingMs - left.totalReadingMs;
  })
  .map((book) => book.authors[0] ?? "")
  .filter(Boolean)
  .slice(0, 4);

const personalizedRecommendations = await buildPersonalizedRecommendations({
  books: enrichedBooks,
  favoriteGenres: favoriteGenresForApi,
  favoriteAuthors: favoriteAuthorsForApi,
  recentFocusAuthors
});

const featuredBooks: FeaturedBook[] = enrichedBooks
  .filter((book) => book.totalReadingMs > 0 && book.title !== "Untitled")
  .sort((left, right) => right.totalReadingMs - left.totalReadingMs)
  .slice(0, 4)
  .map((book, index) => ({
    bookId: book.id,
    title: book.title,
    author: book.authors[0] ?? "Unknown author",
    stat:
      book.completionCount > 0
        ? `${formatCompactHours(book.totalReadingMs / 3_600_000)} · finished`
        : `${formatCompactHours(book.totalReadingMs / 3_600_000)} logged`,
    accent: ["#d6c2a8", "#d6a15d", "#5f7690", "#8aa6a3"][index % 4],
    coverUrl: book.coverUrl
  }));

const clickedUnreadBooks = enrichedBooks
  .filter((book) => book.recommendationClickCount > 0 && book.totalReadingMs === 0 && book.completionCount === 0)
  .sort((left, right) => right.recommendationClickCount - left.recommendationClickCount)
  .slice(0, 8)
  .map((book) => ({
    title: book.title,
    author: book.authors[0] ?? "Unknown author",
    clicks: book.recommendationClickCount,
    readingHours: Math.round((book.totalReadingMs / 3_600_000) * 10) / 10
  }));

const analyticsSummary = {
  generatedAt: new Date().toISOString(),
  coverage: {
    books: extracted.books.length,
    readingSessions: extracted.readingSessions.length,
    completions: extracted.completions.length,
    annotations: extracted.annotations.length,
    ownership: extracted.ownership.length,
    recommendationEvents: extracted.recommendationEvents.length,
    mostRecentPageReadEvents: extracted.mostRecentPageReadEvents.length,
    mostRecentPageReadDialogEvents: extracted.mostRecentPageReadDialogEvents.length,
    bookOpenEvents: extracted.bookOpenEvents.length,
    bookCloseEvents: extracted.bookCloseEvents.length,
    annotationActionEvents: extracted.annotationActionEvents.length,
    notebookActionEvents: extracted.notebookActionEvents.length,
    recommendationImpressionEvents: extracted.recommendationImpressionEvents.length,
    searchQueryEvents: extracted.searchQueryEvents.length,
    searchResultEvents: extracted.searchResultEvents.length,
    sendToKindleEvents: extracted.sendToKindleEvents.length,
    bookRewardEvents: extracted.bookRewardEvents.length,
    librarySnapshotEvents: extracted.librarySnapshotEvents.length
  },
  currentSignals: {
    latestTrackedDay,
    latestMostRecentPageRead: extracted.mostRecentPageReadEvents
      .filter((event) => event.bookId && event.createdAt && analyticsEligibleBookIds.has(event.bookId))
      .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
      .slice(0, 10)
      .map((event) => {
        const book = event.bookId ? enrichedBooksById.get(event.bookId) : null;
        return {
          bookId: event.bookId,
          title: book?.title ?? null,
          author: book?.authors[0] ?? null,
          createdAt: event.createdAt,
          customerAction: event.customerAction,
          desiredPageLocation: event.desiredPageLocation,
          deviceFamily: event.deviceFamily
        };
      }),
    latestBookOpenEvents: extracted.bookOpenEvents
      .filter((event) => event.bookId && event.createdAt && analyticsEligibleBookIds.has(event.bookId))
      .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
      .slice(0, 10)
      .map((event) => {
        const book = event.bookId ? enrichedBooksById.get(event.bookId) : null;
        return {
          bookId: event.bookId,
          title: book?.title ?? null,
          author: book?.authors[0] ?? null,
          createdAt: event.createdAt,
          loadMethod: event.loadMethod,
          contentLanguage: event.contentLanguage,
          deviceFamily: event.deviceFamily
        };
      })
  },
  annotationHabits: {
    topAnnotationActions: rankStringCounts(extracted.annotationActionEvents.map((event) => event.action)),
    topAnnotationTypes: rankStringCounts(extracted.annotationActionEvents.map((event) => event.annotationType)),
    notebookActions: rankStringCounts(extracted.notebookActionEvents.map((event) => event.action)),
    topBooksByAnnotationActions: [...extracted.annotationActionEvents.reduce((map, event) => {
      if (!event.bookId || !analyticsEligibleBookIds.has(event.bookId)) {
        return map;
      }
      map.set(event.bookId, (map.get(event.bookId) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([bookId, count]) => {
        const book = enrichedBooksById.get(bookId);
        return {
          bookId,
          title: book?.title ?? null,
          author: book?.authors[0] ?? null,
          count
        };
      })
  },
  discoveryHabits: {
    recommendationImpressionLocations: rankStringCounts(
      extracted.recommendationImpressionEvents.map((event) => event.location)
    ),
    recommendationImpressionTypes: rankStringCounts(
      extracted.recommendationImpressionEvents.map((event) => event.recommendationType)
    ),
    searchEntryLocations: rankStringCounts(extracted.searchQueryEvents.map((event) => event.entryLocation)),
    searchOutcomes: rankStringCounts(extracted.searchResultEvents.map((event) => event.searchOutcome)),
    selectedSearchBooks: [...extracted.searchResultEvents.reduce((map, event) => {
      if (!event.selectedBookId || !analyticsEligibleBookIds.has(event.selectedBookId)) {
        return map;
      }
      map.set(event.selectedBookId, (map.get(event.selectedBookId) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([bookId, count]) => {
        const book = enrichedBooksById.get(bookId);
        return {
          bookId,
          title: book?.title ?? null,
          author: book?.authors[0] ?? null,
          count
        };
      })
  },
  personalDocumentPipeline: {
    sendToKindleChannels: rankStringCounts(extracted.sendToKindleEvents.map((event) => event.channel)),
    sendToKindleStatuses: rankStringCounts(extracted.sendToKindleEvents.map((event) => event.deliveryStatus)),
    sendToKindleFileTypes: rankStringCounts(extracted.sendToKindleEvents.map((event) => event.fileType)),
    successfulSendToKindleCount: extracted.sendToKindleEvents.filter((event) => event.deliveryStatus === "Success").length
  },
  rewards: {
    totalAchievements: extracted.bookRewardEvents.reduce((sum, event) => sum + (event.quantity ?? 0), 0),
    byGroup: rankStringCounts(extracted.bookRewardEvents.map((event) => event.achievementGroupName)),
    latest: [...extracted.bookRewardEvents]
      .sort((left, right) => (right.earnedAt ?? "").localeCompare(left.earnedAt ?? ""))
      .slice(0, 10)
  },
  librarySnapshots: {
    latest: [...extracted.librarySnapshotEvents]
      .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
      .slice(0, 5),
    platforms: rankStringCounts(extracted.librarySnapshotEvents.map((event) => event.platform))
  }
};

const dashboard: DashboardData = {
  generatedAt: new Date().toISOString(),
  overview: {
    metrics: [
      {
        label: "Reading time",
        value: formatHours(totalReadingHours),
        detail: `${formatCount(extracted.readingSessions.length)} total sessions`
      },
      {
        label: "Active days",
        value: formatCount(activeDays),
        detail: `${currentStreak(extracted.readingTrackedDays)} day streak ending on your latest tracked day`
      },
      {
        label: "Finished titles",
        value: formatCount(completedBooks),
        detail: `${formatCount(analyticsEligibleBooks.filter((book) => book.completionCount > 0).length)} books with at least one completion signal`
      },
      {
        label: "Average session",
        value: formatMinutes(averageSessionMinutes),
        detail: `${formatCount(recommendationClicks)} recommendation clicks captured`
      }
    ],
    latestReadingDay: latestTrackedDay,
    readerProfile: extracted.readerProfile
  },
  trends: {
    daily: dailyTrend,
    monthly: monthlyTrend
  },
  libraryTaste: {
    topAuthors: rankMap(authorMap, authorDetailMap),
    topGenres: rankMap(genreMap),
    topSeries: rankMap(seriesMap),
    topBooks: rankMap(topBookMap),
    formatMix: rankMap(formatMap)
  },
  discovery: {
    recommendationViews,
    recommendationClicks,
    clickedUnreadBooks
  },
  readingInsights: {
    currentPeriodLabel: "Hours per Day",
    currentPeriodValue: formatCompactHours(currentPeriodHours),
    currentPeriodDetail: `${currentPeriodChart.length} recent tracked days`,
    currentPeriodChart,
    vitalMetrics: [
      {
        label: "Average session",
        value: formatMinutes(averageSessionMinutes)
      },
      {
        label: "Highlights & notes",
        value: formatCount(totalHighlightCount + totalNoteCount)
      },
      {
        label: `${referenceYear} reading time`,
        value: formatHours(currentYearReadingMs / 3_600_000)
      }
    ],
    daypartShares,
    milestones,
    parallelReading,
    genreShares,
    rhythm: {
      favoriteWeekday,
      favoriteDaypart,
      quote: `You read most on ${favoriteWeekday}s, usually in the ${favoriteDaypart.toLowerCase()} around ${daypartWindows[favoriteDaypart]}.`,
      badges: [`${favoriteDaypart} reader`, `${favoriteWeekday} ritual`]
    },
    curatorTip: {
      title: "The Curator's Tip",
      body:
        recommendations[0]?.reasons[0] ??
        "Revisit a favorite subject this week and pair it with one unfamiliar genre to keep your reading life varied.",
      cta: recommendations[0]?.title ? `Try ${recommendations[0].title}` : "Browse recommendations"
    },
    featuredBooks
  },
  books: analyticsEligibleBooks
    .sort((left, right) => right.totalReadingMs - left.totalReadingMs)
    .slice(0, 250),
  recommendations,
  personalizedRecommendations,
  completionEvents: extracted.completions.map((completion) => ({
    bookId: completion.bookId,
    completedAt: completion.completedAt,
    source: completion.source
  }))
};

writeJson("dashboard.json", dashboard);
writeJson("recommendations.json", recommendations);
writeJson("analytics_summary.json", analyticsSummary);

console.log(
  `Built dashboard data with ${dashboard.books.length} books and ${dashboard.recommendations.length} recommendations.`
);
