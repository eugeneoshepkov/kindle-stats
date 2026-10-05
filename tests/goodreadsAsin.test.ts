import { describe, expect, test } from "bun:test";
import {
  goodreadsHtmlDeclaresKindleAsin,
  isGoodreadsAsinMissPage,
  kindleAsinLookupKey,
  kindleStoreAsinKey,
  parseGoodreadsBookFromHtml
} from "../src/lib/goodreadsAsin";
import { mergeKindleAsinTitleHint } from "../src/lib/kindleAsinTitleHints";
import type { NormalizedBook } from "../src/lib/types";

describe("parseGoodreadsBookFromHtml", () => {
  test("reads JSON-LD Book name and authors", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"Test Book Full Title","author":[{"@type":"Person","name":"Jane Doe"}]}</script>`;
    const out = parseGoodreadsBookFromHtml(html);
    expect(out?.title).toBe("Test Book Full Title");
    expect(out?.authors).toEqual(["Jane Doe"]);
    expect(out?.coverUrl).toBeNull();
  });

  test("extracts cover URL from JSON-LD image field", () => {
    const html = `<script type="application/ld+json">{"@type":"Book","name":"Covered Book","author":[],"image":"https://m.media-amazon.com/images/S/covers/12345.jpg"}</script>`;
    const out = parseGoodreadsBookFromHtml(html);
    expect(out?.coverUrl).toBe("https://m.media-amazon.com/images/S/covers/12345.jpg");
  });

  test("falls back to og:image when JSON-LD has no image", () => {
    const html = `<head><meta property="og:image" content="https://example.com/og-cover.jpg"/><title>Og Book by Writer | Goodreads</title></head>`;
    const out = parseGoodreadsBookFromHtml(html);
    expect(out?.title).toBe("Og Book");
    expect(out?.coverUrl).toBe("https://example.com/og-cover.jpg");
  });

  test("falls back to title tag with byline", () => {
    const html = `<head><title>Some Novel by A. Writer | Goodreads</title></head>`;
    const out = parseGoodreadsBookFromHtml(html);
    expect(out?.title).toBe("Some Novel");
    expect(out?.authors).toEqual(["A. Writer"]);
    expect(out?.coverUrl).toBeNull();
  });
});

describe("kindleStoreAsinKey", () => {
  test("only uses catalog asin field", () => {
    expect(kindleStoreAsinKey({ asin: "B003KVKYAM" })).toBe("B003KVKYAM");
    expect(kindleStoreAsinKey({ asin: null })).toBe(null);
  });
});

describe("kindleAsinLookupKey", () => {
  test("uses personalDocumentId when asin is null (for manual hint maps only)", () => {
    expect(
      kindleAsinLookupKey({
        asin: null,
        personalDocumentId: "B003KVKYAM",
        nonAsinId: null
      })
    ).toBe("B003KVKYAM");
  });
});

describe("goodreadsHtmlDeclaresKindleAsin", () => {
  test("finds embedded Kindle ASIN in GR payload", () => {
    const html = `details":{"__typename":"BookDetails","asin":"B0119EPY06","format":"Kindle Edition"}`;
    expect(goodreadsHtmlDeclaresKindleAsin(html, "B0119EPY06")).toBe(true);
    expect(goodreadsHtmlDeclaresKindleAsin(html, "B099999999")).toBe(false);
  });
});

describe("isGoodreadsAsinMissPage", () => {
  test("detects not-found page", () => {
    expect(isGoodreadsAsinMissPage(`<html><head><title>Page not found</title></head></html>`)).toBe(true);
  });

  test("allows book page", () => {
    expect(
      isGoodreadsAsinMissPage(
        `<html><head><title>Real Book by Author | Goodreads</title></head><body>ok</body></html>`
      )
    ).toBe(false);
  });
});

describe("mergeKindleAsinTitleHint with Goodreads cover", () => {
  const baseBook: NormalizedBook = {
    id: "asin:B003KVKYAM",
    asin: "B003KVKYAM",
    isbn: null,
    personalDocumentId: null,
    nonAsinId: null,
    title: "Untitled",
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

  test("applies Goodreads cover to Untitled book with no existing cover", () => {
    const cache = {
      B003KVKYAM: {
        title: "Real Book",
        authors: ["Real Author"],
        coverUrl: "https://m.media-amazon.com/images/S/covers/real.jpg",
        fetchedAt: "2026-01-01T00:00:00.000Z"
      }
    };
    const result = mergeKindleAsinTitleHint(baseBook, cache);
    expect(result.title).toBe("Real Book");
    expect(result.coverUrl).toBe("https://m.media-amazon.com/images/S/covers/real.jpg");
    expect(result.coverSource).toBe("goodreads");
  });

  test("does not overwrite existing cover", () => {
    const bookWithCover = { ...baseBook, title: "Untitled", coverUrl: "https://existing.com/cover.jpg" };
    const cache = {
      B003KVKYAM: {
        title: "Real Book",
        coverUrl: "https://m.media-amazon.com/images/S/covers/real.jpg",
        fetchedAt: "2026-01-01T00:00:00.000Z"
      }
    };
    const result = mergeKindleAsinTitleHint(bookWithCover, cache);
    expect(result.coverUrl).toBe("https://existing.com/cover.jpg");
  });

  test("applies Goodreads cover even when title is already known", () => {
    const bookWithTitle: NormalizedBook = { ...baseBook, title: "Known Title", coverUrl: null };
    const cache = {
      B003KVKYAM: {
        title: "Known Title",
        coverUrl: "https://m.media-amazon.com/images/S/covers/real.jpg",
        fetchedAt: "2026-01-01T00:00:00.000Z"
      }
    };
    const result = mergeKindleAsinTitleHint(bookWithTitle, cache);
    expect(result.coverUrl).toBe("https://m.media-amazon.com/images/S/covers/real.jpg");
  });
});
