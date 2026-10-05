export type GoodreadsAsinCacheEntry = {
  title?: string;
  authors?: string[];
  coverUrl?: string;
  miss?: boolean;
  fetchedAt: string;
};

export type GoodreadsAsinCache = Record<string, GoodreadsAsinCacheEntry>;

export function kindleStoreAsinKey(book: { asin?: string | null }): string | null {
  const s = book.asin?.trim().toUpperCase();
  if (s && /^[A-Z0-9]{10}$/.test(s)) {
    return s;
  }
  return null;
}

export function kindleAsinLookupKey(book: {
  asin?: string | null;
  personalDocumentId?: string | null;
  nonAsinId?: string | null;
}): string | null {
  const candidates = [book.asin, book.personalDocumentId, book.nonAsinId];
  for (const raw of candidates) {
    const s = raw?.trim().toUpperCase();
    if (s && /^[A-Z0-9]{10}$/.test(s)) {
      return s;
    }
  }
  return null;
}

type LdAuthor = { name?: string } | string | Array<{ name?: string } | string> | undefined;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normalizeLdAuthors(author: LdAuthor): string[] {
  if (!author) {
    return [];
  }

  const list = Array.isArray(author) ? author : [author];
  const names: string[] = [];

  for (const item of list) {
    if (typeof item === "string") {
      names.push(decodeHtmlEntities(item.trim()));
    } else if (item && typeof item === "object" && item.name) {
      names.push(decodeHtmlEntities(String(item.name).trim()));
    }
  }

  return names.filter(Boolean);
}

function extractLdJsonBook(html: string): { name?: string; author?: LdAuthor; image?: string } | null {
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }

    try {
      const data = JSON.parse(raw) as unknown;
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item && typeof item === "object" && (item as { "@type"?: string })["@type"] === "Book") {
          const book = item as { name?: string; author?: LdAuthor; image?: string };
          if (book.name?.trim()) {
            return book;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractOgImage(html: string): string | null {
  const m =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  return m?.[1] ?? null;
}

function parseTitleTagLine(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const inner = match?.[1]?.trim();
  if (!inner || /page not found/i.test(inner)) {
    return null;
  }
  return decodeHtmlEntities(inner);
}

export function parseGoodreadsBookFromHtml(
  html: string
): { title: string; authors: string[]; coverUrl: string | null } | null {
  const ld = extractLdJsonBook(html);
  const coverUrl =
    (typeof ld?.image === "string" && ld.image.startsWith("http") ? ld.image : null) ??
    extractOgImage(html);

  if (ld?.name?.trim()) {
    return {
      title: decodeHtmlEntities(ld.name.trim()),
      authors: normalizeLdAuthors(ld.author),
      coverUrl
    };
  }

  const titleLine = parseTitleTagLine(html);
  if (!titleLine) {
    return null;
  }

  const core = titleLine.replace(/\s*\|\s*Goodreads\s*$/i, "").trim();
  const byIdx = core.lastIndexOf(" by ");
  if (byIdx <= 0) {
    return { title: core, authors: [], coverUrl };
  }

  return {
    title: core.slice(0, byIdx).trim(),
    authors: [core.slice(byIdx + 4).trim()].filter(Boolean),
    coverUrl
  };
}

export function goodreadsHtmlDeclaresKindleAsin(html: string, asin: string): boolean {
  const id = asin.trim().toUpperCase();
  if (!id) {
    return false;
  }
  return (
    html.includes(`"asin":"${id}"`) ||
    html.includes(`"asin": "${id}"`) ||
    html.includes(`'asin':'${id}'`)
  );
}

export function isGoodreadsAsinMissPage(html: string): boolean {
  if (/Sorry,\s*that page doesn'?t exist/i.test(html)) {
    return true;
  }
  if (/<title[^>]*>\s*Page not found\s*</i.test(html)) {
    return true;
  }
  if (/<h1[^>]*>\s*Page not found/i.test(html)) {
    return true;
  }
  return false;
}
