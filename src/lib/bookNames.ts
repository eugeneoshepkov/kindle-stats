const PLACEHOLDER_AUTHORS = new Set(["unknown", "unknown author", "anonymous", "n/a"]);
const CREDENTIALS = /(?:^|[\s,])(?:Ph\.?\s?D\.?|M\.?D\.?|Dr\.)(?=$|[\s,])/giu;

function isSingleName(value: string): boolean {
  return !/\s/u.test(value.trim());
}

/**
 * One author entry as people write it: "Hof, Wim" → "Wim Hof", "Peter Attia, MD" → "Peter Attia",
 * "Роман Баданин, Михаил Рубин" → two authors, "Unknown" → none.
 */
export function normalizeAuthorName(raw: string): string[] {
  const name = raw
    .normalize("NFC")
    .replace(CREDENTIALS, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s*[,;]\s*$/u, "")
    .replace(/^\s*,\s*/u, "")
    .trim();
  if (!name || PLACEHOLDER_AUTHORS.has(name.toLowerCase())) {
    return [];
  }

  const parts = name.split(/\s*,\s*/u).filter(Boolean);
  if (parts.length === 2 && isSingleName(parts[0])) {
    return [`${parts[1]} ${parts[0]}`];
  }
  if (parts.length > 1 && parts.every((part) => !isSingleName(part))) {
    return parts;
  }
  return [name];
}

export function normalizeAuthors(authors: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of authors.flatMap(normalizeAuthorName)) {
    const key = name.toLowerCase().replace(/[^\p{L}]/gu, "");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Display cleanup for catalog and file-name titles: store edition tags, "A Novel" subtitles,
 * library-catalog " : " spacing and a trailing "by Author" / "- Author".
 */
export function cleanDisplayTitle(raw: string, authors: string[] = []): string {
  // File names often carry decomposed letters (и + U+0306 for й); compose them so author matching works.
  let title = raw.normalize("NFC").replace(/\s+/gu, " ").trim();

  for (;;) {
    const next = title
      .replace(/\s*\((?:[\p{L}]+ Edition|US|UK|Readers)\)\s*$/iu, "")
      .replace(/\s*:\s*a novel\s*$/iu, "")
      .trim();
    if (next === title) {
      break;
    }
    title = next;
  }

  for (const author of authors) {
    const name = escapeRegExp(author.normalize("NFC").trim());
    if (name) {
      title = title.replace(new RegExp(`\\s+(?:by|-|–|—)\\s+${name}\\s*$`, "iu"), "");
    }
  }

  title = title.replace(/\s+:\s*/gu, ": ").replace(/:\s*$/u, "").trim();
  return title || raw.trim();
}
