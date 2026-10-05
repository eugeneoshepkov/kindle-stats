import {
  type GoodreadsAsinCache,
  kindleAsinLookupKey,
  kindleStoreAsinKey
} from "./goodreadsAsin";

export type KindleAsinTitleHint = {
  title: string;
  authors?: string[];
};

export const kindleAsinTitleHints: Record<string, KindleAsinTitleHint> = {
  B08HCMTTQS: {
    title: "Die Kunst, in schwierigen Zeiten nicht durchzudrehen",
    authors: ["Ralf Senftleben"]
  },
  B01M02FJ7A: {
    title: "Harry Potter und der Stein der Weisen",
    authors: ["J.K. Rowling"]
  },
  B0DM1JVKD7: {
    title: "Grokking Deep Learning",
    authors: ["Andrew W. Trask"]
  }
};

export function mergeKindleAsinTitleHint<
  T extends {
    asin?: string | null;
    personalDocumentId?: string | null;
    nonAsinId?: string | null;
    title: string;
    authors: string[];
    coverUrl?: string | null;
    coverSource?: string | null;
  }
>(book: T, goodreadsByAsin?: GoodreadsAsinCache | null): T {
  const hintKey = kindleAsinLookupKey(book);
  if (!hintKey) {
    return book;
  }

  const staticHint = kindleAsinTitleHints[hintKey];
  let next = book;

  if (staticHint) {
    next = {
      ...book,
      title: staticHint.title,
      authors: staticHint.authors?.length ? staticHint.authors : book.authors
    };
  }

  const storeAsin = kindleStoreAsinKey(book);
  if (!storeAsin || !goodreadsByAsin) {
    return next;
  }

  const gr = goodreadsByAsin[storeAsin];
  if (!gr || gr.miss) {
    return next;
  }

  const titleUpdate = gr.title?.trim() && next.title === "Untitled" ? { title: gr.title.trim() } : {};
  const authorsUpdate =
    gr.authors?.length && (next.title === "Untitled" || titleUpdate.title)
      ? { authors: gr.authors }
      : {};
  const coverUpdate =
    gr.coverUrl && !next.coverUrl ? { coverUrl: gr.coverUrl, coverSource: "goodreads" } : {};

  if (!titleUpdate.title && !coverUpdate.coverUrl) {
    return next;
  }

  return {
    ...next,
    ...titleUpdate,
    ...authorsUpdate,
    ...coverUpdate
  };
}
