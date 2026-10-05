import { describe, expect, test } from "bun:test";
import { inferBookTitle } from "../src/lib/inferBookTitle";
import { normalizeGenreLabel } from "../src/lib/normalizeGenre";
import { normalizeDate, normalizeString, toBookKey } from "../src/lib/normalizeKindle";
import { recommendBooks } from "../src/lib/recommendBooks";
import { isGoogleBooksPlaceholderVolumeCoverUrl } from "../src/lib/googleBooksCover";
import { pickBestGoogleBooksImageLink, resolveCoverImageUrlForDisplay, upgradeCoverImageUrl } from "../src/lib/upgradeCoverUrl";
import type { EnrichedBook } from "../src/lib/types";

function makeBook(overrides: Partial<EnrichedBook>): EnrichedBook {
  return {
    id: "book",
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
    contentType: "E-Book",
    marketplace: "www.amazon.de",
    isPersonalDocument: false,
    coverUrl: null,
    coverSource: null,
    totalReadingMs: 0,
    sessionCount: 0,
    completionCount: 0,
    annotationCount: 0,
    noteCount: 0,
    highlightCount: 0,
    lastReadAt: null,
    lastAnnotatedAt: null,
    recommendationViewCount: 0,
    recommendationClickCount: 0,
    isOwned: true,
    ...overrides
  };
}

describe("normalizeKindle helpers", () => {
  test("normalizes exported missing values", () => {
    expect(normalizeString("Not Available")).toBeNull();
    expect(normalizeString("  actual title  ")).toBe("actual title");
  });

  test("creates stable book keys", () => {
    expect(toBookKey({ asin: "B012345678" })).toBe("asin:B012345678");
    expect(toBookKey({ personalDocumentId: "PDOC123" })).toBe("doc:PDOC123");
    expect(toBookKey({ nonAsinId: "PDOC123" })).toBe("doc:PDOC123");
    expect(toBookKey({ title: "Project Hail Mary" })).toBe("title:project hail mary");
  });

  test("parses ISO dates and rejects invalid ones", () => {
    expect(normalizeDate("2026-04-06T12:46:09.200Z")).toBe("2026-04-06T12:46:09.200Z");
    expect(normalizeDate("not-a-date")).toBeNull();
  });
});

describe("inferBookTitle", () => {
  test("strips author prefixes and publisher tails from filenames", () => {
    expect(
      inferBookTitle({
        documentId: "UCHRF4EDVQ3QCFZZVV3R7I76POGF7NWD",
        title: "John Romero - Doom Guy_ Life in First Person-Harry N. Abrams (2023)",
        author: "John Romero"
      })
    ).toBe("Doom Guy: Life in First Person");
  });

  test("uses web-backed aliases for hard cases", () => {
    expect(
      inferBookTitle({
        documentId: "K4YXTD4IQVSAX2IBZLNH6Z6XIP2L2RRJ",
        title: "Zyigar_M._Imperiya_Doljna_Umeret",
        author: "Михаил Зыгарь"
      })
    ).toBe("Империя должна умереть");
  });

  test("strips Z-Library tags and a trailing author in parentheses", () => {
    expect(
      inferBookTitle({
        title: "I Will Show You How It Was The Story of Wartime Kyiv (Illia Ponomarenko) (Z-Library)",
        author: "Illia Ponomarenko"
      })
    ).toBe("I Will Show You How It Was The Story of Wartime Kyiv");
  });

  test("strips PDFDrive tags, including escaped parentheses", () => {
    expect(
      inferBookTitle({
        title: "The Bitcoin Standard_ The Decentralized Alternative to Central Banking \\( PDFDrive.com \\)"
      })
    ).toBe("The Bitcoin Standard: The Decentralized Alternative to Central Banking");
  });

  test("strips azw8 extensions and source slugs", () => {
    expect(
      inferBookTitle({
        title: "ne-uboyus-zla.azw8",
        author: "Натан Борисович Щаранский"
      })
    ).toBe("Не убоюсь зла");
  });

  test("strips HarperCollins personal-document title tails", () => {
    expect(
      inferBookTitle({
        title: "She comes first: the thinking man's guide to pleasuring a woman-HarperCollins e",
        author: "Ian Kerner"
      })
    ).toBe("She comes first: the thinking man's guide to pleasuring a woman");
  });
});

describe("normalizeGenreLabel", () => {
  test("maps localized Amazon genres to English", () => {
    expect(normalizeGenreLabel("Business & Karriere")).toBe("Business & Money");
    expect(normalizeGenreLabel("Politik & Geschichte")).toBe("Politics & Social Sciences");
    expect(normalizeGenreLabel("Fachbücher")).toBe("Professional & Technical");
    expect(normalizeGenreLabel("Biografien & Erinnerungen")).toBe("Biographies & Memoirs");
  });
});

describe("isGoogleBooksPlaceholderVolumeCoverUrl", () => {
  test("flags catalogue-only Google volume ids", () => {
    expect(
      isGoogleBooksPlaceholderVolumeCoverUrl(
        "https://books.google.com/books/content?id=xmqQzQEACAAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api"
      )
    ).toBe(true);
    expect(
      isGoogleBooksPlaceholderVolumeCoverUrl(
        "https://books.google.com/books/content?id=6_mzEAAAQBAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api"
      )
    ).toBe(false);
  });
});

describe("resolveCoverImageUrlForDisplay", () => {
  test("drops placeholder Google cover urls", () => {
    expect(
      resolveCoverImageUrlForDisplay(
        "https://books.google.com/books/content?id=WR_mzgEACAAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api"
      )
    ).toBe(null);
  });
});

describe("upgradeCoverImageUrl", () => {
  test("sets Google Books content URLs to zoom 0", () => {
    const url =
      "http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api";
    const out = upgradeCoverImageUrl(url);
    expect(out).toContain("zoom=0");
    expect(out).toContain("https://");
    expect(out).not.toContain("edge=curl");
  });

  test("leaves Open Library URLs unchanged", () => {
    const url = "https://covers.openlibrary.org/b/isbn/1234567890-L.jpg?default=false";
    expect(upgradeCoverImageUrl(url)).toBe(url);
  });
});

describe("pickBestGoogleBooksImageLink", () => {
  test("prefers extraLarge over thumbnail", () => {
    const url = pickBestGoogleBooksImageLink({
      extraLarge: "http://books.google.com/books/content?id=x&zoom=1",
      thumbnail: "http://books.google.com/books/content?id=y&zoom=1"
    });
    expect(url).toContain("id=x");
    expect(url).toContain("zoom=0");
  });
});

describe("recommendBooks", () => {
  test("prioritizes same-series and favorite-author followups", () => {
    const books: EnrichedBook[] = [
      makeBook({
        id: "finished-series-book",
        title: "Series Book One",
        authors: ["Andy Weir"],
        genres: ["Science Fiction"],
        seriesTitle: "Space Saga",
        completionCount: 1,
        totalReadingMs: 8 * 3_600_000
      }),
      makeBook({
        id: "candidate-series-book",
        title: "Series Book Two",
        authors: ["Andy Weir"],
        genres: ["Science Fiction"],
        seriesTitle: "Space Saga",
        recommendationClickCount: 1
      }),
      makeBook({
        id: "weaker-candidate",
        title: "Random Memoir",
        authors: ["Another Author"],
        genres: ["Memoir"]
      })
    ];

    const recommendations = recommendBooks(books);

    expect(recommendations[0]?.bookId).toBe("candidate-series-book");
    expect(recommendations[0]?.reasons.join(" ")).toContain("series");
  });
});
