import { normalizeString } from "./normalizeKindle";

const titleAliasesByDocumentId: Record<string, string> = {
  K4YXTD4IQVSAX2IBZLNH6Z6XIP2L2RRJ: "Империя должна умереть",
  "3DGVUWFFTRQFJR47ZKWKI7U3OITJ5OV4": "Олигархи. Богатство и власть в новой России"
};

const titleAliasesByRawValue: Record<string, string> = {
  "zyigar_m._imperiya_doljna_umeret": "Империя должна умереть",
  "avidreaders.ru__oligarhi-bogatstvo-i-vlast-v-novoy": "Олигархи. Богатство и власть в новой России",
  "ne-uboyus-zla": "Не убоюсь зла",
  "tsar_sobstvennoy_personoy": "Царь собственной персоной"
};

function cleanupWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function removeExtension(value: string): string {
  return value.replace(/\.(azw\d*|mobi|epub|pdf)$/i, "");
}

function stripKnownSourceNoise(value: string): string {
  return value
    .replace(/\s*-\s*libgen\.[a-z]+(?:\.\w+)?$/i, "")
    .replace(/^_?OceanofPDF\.com_?/i, "")
    .replace(/^avidreaders\.ru__?/i, "")
    .replace(/\s*--\s*Anna['’]s Archive.*$/i, "")
    .replace(/\s+\(z-lib\.org\)$/i, "")
    .replace(/\s+\(Z-Library\)$/i, "")
    .replace(/\s*\\?\(\s*PDFDrive\.com\s*\\?\)$/i, "")
    .replace(/\s+-\s+PDFDrive\.com$/i, "")
    .replace(/\s+-\s*royallib\.com\s*$/iu, "");
}

function stripPublisherTail(value: string): string {
  return value
    .replace(/\s*[-–—]HarperCollins\s*e\s*$/iu, "")
    .replace(/\s*-\s*[^-()]+?\(\d{4}\)\s*$/u, "")
    .replace(/\s*\(\d{4},\s*[^)]+\)\s*$/u, "")
    .replace(/\s+\d{4}\s*$/u, "");
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9а-яё]+/giu, "");
}

function looksLikeAuthorSegment(segment: string, author: string | null): boolean {
  if (!author) {
    return false;
  }

  const normalizedSegment = normalizeForMatch(segment);
  const normalizedAuthor = normalizeForMatch(author);
  if (!normalizedSegment || !normalizedAuthor) {
    return false;
  }

  if (normalizedSegment.includes(normalizedAuthor) || normalizedAuthor.includes(normalizedSegment)) {
    return true;
  }

  const tokens = author
    .toLowerCase()
    .split(/[^a-z0-9а-яё]+/iu)
    .filter(Boolean);

  return tokens.length > 0 && tokens.every((token) => normalizedSegment.includes(token));
}

function stripAuthorPrefix(value: string, author: string | null): string {
  const parts = value.split(/\s+-\s+/u);
  if (parts.length < 2) {
    return value;
  }

  const [left, ...rest] = parts;
  const right = rest.join(" - ");
  const leftWithoutSeries = left.replace(/^\([^)]*\)\s*/u, "");

  if (looksLikeAuthorSegment(leftWithoutSeries, author) || looksLikeAuthorSegment(left, author)) {
    return right;
  }

  return value;
}

/** "Title (Author Name)" → "Title", only when the parentheses hold the known author. */
function stripAuthorSuffix(value: string, author: string | null): string {
  const match = value.match(/^(.+?)\s*\(([^()]+)\)$/u);
  return match && looksLikeAuthorSegment(match[2], author) ? match[1] : value;
}

function normalizeSeparators(value: string): string {
  return value
    .replace(/_/g, ": ")
    .replace(/\s*:\s*:/g, ": ")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s{2,}/g, " ");
}

function trimAtMetadataBreak(value: string): string {
  const breaks = [
    /\s+--\s+/u,
    /--/u,
    /\s+\|\|\s+/u
  ];

  for (const pattern of breaks) {
    const match = value.search(pattern);
    if (match > 0) {
      return value.slice(0, match);
    }
  }

  return value;
}

function prettifySlug(value: string): string {
  const slug = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!slug) {
    return "Untitled";
  }

  return slug;
}

export function inferBookTitle(input: {
  documentId?: string | null;
  title?: string | null;
  filename?: string | null;
  author?: string | null;
}): string {
  const documentId = normalizeString(input.documentId);
  if (documentId && titleAliasesByDocumentId[documentId]) {
    return titleAliasesByDocumentId[documentId];
  }

  const author = normalizeString(input.author);
  const primary = normalizeString(input.title) ?? normalizeString(input.filename) ?? "Untitled";
  const aliasedPrimary = titleAliasesByRawValue[primary.toLowerCase()];
  if (aliasedPrimary) {
    return aliasedPrimary;
  }

  let resolved = removeExtension(primary);
  const aliasedResolved = titleAliasesByRawValue[resolved.toLowerCase()];
  if (aliasedResolved) {
    return aliasedResolved;
  }
  resolved = stripKnownSourceNoise(resolved);
  resolved = trimAtMetadataBreak(resolved);
  resolved = stripAuthorPrefix(resolved, author);
  resolved = trimAtMetadataBreak(resolved);
  resolved = stripPublisherTail(resolved);
  resolved = normalizeSeparators(resolved);
  resolved = stripKnownSourceNoise(resolved);
  resolved = stripPublisherTail(resolved);
  resolved = stripAuthorSuffix(cleanupWhitespace(resolved), author);
  resolved = cleanupWhitespace(resolved);

  if (resolved === "Untitled" && input.filename) {
    resolved = prettifySlug(stripKnownSourceNoise(removeExtension(input.filename)));
  }

  if (!resolved || resolved === "Untitled") {
    return "Untitled";
  }

  return resolved;
}
