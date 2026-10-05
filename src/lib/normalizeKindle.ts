import type { NormalizedBook } from "./types";

const MISSING_VALUES = new Set(["", "Not Available", "Not Applicable"]);

export function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^\uFEFF/, "");
  return MISSING_VALUES.has(trimmed) ? null : trimmed;
}

export function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDate(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function toBookKey(parts: {
  asin?: string | null;
  personalDocumentId?: string | null;
  nonAsinId?: string | null;
  title?: string | null;
  fallback?: string | null;
}): string {
  if (parts.asin) {
    return `asin:${parts.asin}`;
  }

  const documentId = parts.personalDocumentId ?? parts.nonAsinId;
  if (documentId) {
    return `doc:${documentId}`;
  }

  const normalizedTitle = normalizeTitle(parts.title);
  if (normalizedTitle) {
    return `title:${normalizedTitle}`;
  }

  if (parts.fallback) {
    return `fallback:${parts.fallback}`;
  }

  return "fallback:unknown";
}

export function mergeUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function normalizeTitle(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  return normalized.toLowerCase().replace(/\s+/g, " ").trim();
}

export function createEmptyBook(id: string): NormalizedBook {
  return {
    id,
    title: "Untitled",
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
