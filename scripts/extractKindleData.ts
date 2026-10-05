import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { normalizeGenreLabel } from "../src/lib/normalizeGenre";
import { inferBookTitle } from "../src/lib/inferBookTitle";
import {
  createEmptyBook,
  mergeUnique,
  normalizeDate,
  normalizeNumber,
  normalizeString,
  toBookKey
} from "../src/lib/normalizeKindle";
import type {
  AnnotationActionEvent,
  BookCloseEvent,
  BookOpenEvent,
  BookRewardEvent,
  ExtractedData,
  LibrarySnapshotEvent,
  MostRecentPageReadDialogEvent,
  MostRecentPageReadEvent,
  NormalizedAnnotation,
  NormalizedBook,
  NormalizedCompletion,
  NormalizedOwnership,
  NormalizedReadingSession,
  NotebookActionEvent,
  RecommendationImpressionEvent,
  ReaderProfileSnapshot,
  RecommendationEvent,
  SearchQueryEvent,
  SearchResultEvent,
  SendToKindleEvent
} from "../src/lib/types";

type CsvRow = Record<string, string>;

type LoadedArchive = {
  path: string;
  zip: AdmZip;
  entryNames: string[];
  exportedAt: number;
};

const workspaceRoot = process.cwd();
const exportsDir = join(workspaceRoot, "data", "exports");
const outputDir = join(workspaceRoot, "data", "processed");

// An explicit KINDLE_ARCHIVE_PATH wins; otherwise every export in data/exports is merged,
// falling back to the single root archive when that folder is empty.
function resolveArchivePaths(): string[] {
  if (process.env.KINDLE_ARCHIVE_PATH) {
    return [process.env.KINDLE_ARCHIVE_PATH];
  }

  const exportPaths = existsSync(exportsDir)
    ? readdirSync(exportsDir)
        .filter((name) => name.toLowerCase().endsWith(".zip"))
        .map((name) => join(exportsDir, name))
    : [];

  return exportPaths.length > 0 ? exportPaths : [join(workspaceRoot, "Amazon Kindle Data.zip")];
}

function loadArchive(path: string): LoadedArchive {
  const archiveZip = new AdmZip(path);
  const files = archiveZip.getEntries().filter((entry) => !entry.isDirectory);

  return {
    path,
    zip: archiveZip,
    entryNames: files.map((entry) => entry.entryName),
    // File mtimes are unreliable after copying, so date each export by its newest member.
    exportedAt: Math.max(0, ...files.map((entry) => entry.header.time.getTime()))
  };
}

// Oldest first, so newer exports win wherever later data overrides earlier data.
const archives = resolveArchivePaths()
  .map(loadArchive)
  .sort((left, right) => left.exportedAt - right.exportedAt);

let zip: AdmZip;
let entryNames: string[];

function useArchive(archive: LoadedArchive): void {
  zip = archive.zip;
  entryNames = archive.entryNames;
}

mkdirSync(outputDir, { recursive: true });

function writeJson(fileName: string, data: unknown): void {
  Bun.write(join(outputDir, fileName), JSON.stringify(data, null, 2));
}

function findFirstEntry(...suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    const match = entryNames.find((entryName) => entryName.endsWith(suffix));
    if (match) {
      return match;
    }
  }

  return null;
}

function findAllEntries(suffix: string): string[] {
  return entryNames.filter((entryName) => entryName.endsWith(suffix));
}

// Older exports split library index datasets by region (`_FRA`, `_ZAZ`); newer ones number them (`.1.1`, `.2.1`).
function findLibraryIndexEntries(dataset: string): string[] {
  const pattern = new RegExp(`(^|/)Kindle\\.UnifiedLibraryIndex\\.${dataset}(_[A-Z]{3}|(\\.\\d+)+)?\\.csv$`);
  return entryNames.filter((entryName) => pattern.test(entryName)).sort();
}

function readCsv(entryName: string | null): CsvRow[] {
  if (!entryName) {
    return [];
  }

  const text = zip.readAsText(entryName, "utf8").replace(/^\uFEFF/, "");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  }) as CsvRow[];
}

function readJson(entryName: string): unknown {
  return JSON.parse(zip.readAsText(entryName, "utf8"));
}

function looksLikeAsin(value: string | null): boolean {
  return Boolean(value && /^[A-Z0-9]{10}$/.test(value));
}

function extractIsbn(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(?<!\d)(97[89]\d{10}|\d{9}[\dXx])(?!\d)/);
  return match ? match[1].toUpperCase() : null;
}

function normalizeBoolean(value: string | null | undefined): boolean | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  if (["yes", "true", "success", "enabled", "on"].includes(normalized.toLowerCase())) {
    return true;
  }

  if (["no", "false", "failure", "disabled", "off"].includes(normalized.toLowerCase())) {
    return false;
  }

  return null;
}

function toBookIdFromContentId(
  value: string | null | undefined,
  input: Omit<Parameters<typeof upsertBook>[0], "asin" | "nonAsinId" | "personalDocumentId">
): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  if (looksLikeAsin(normalized)) {
    return upsertBook({
      ...input,
      asin: normalized
    });
  }

  return upsertBook({
    ...input,
    nonAsinId: normalized,
    isPersonalDocument: input.isPersonalDocument ?? true
  });
}

const books = new Map<string, NormalizedBook>();
const documentMetadata = new Map<
  string,
  {
    title: string;
    author: string | null;
    filename: string | null;
    contentType: string | null;
    isbn: string | null;
  }
>();

// Document metadata from every export is loaded up front so older sessions can use newer titles.
for (const archive of archives) {
  useArchive(archive);

  for (const row of readCsv(findFirstEntry("Kindle.KindleDocs.DocumentMetadata.csv"))) {
    const documentId = normalizeString(row.DocumentId);
    if (!documentId) {
      continue;
    }

    const author = normalizeString(row.DocumentProvider);
    documentMetadata.set(documentId, {
      title: inferBookTitle({
        documentId,
        title: normalizeString(row.Title),
        filename: normalizeString(row.Filename),
        author
      }),
      author,
      filename: normalizeString(row.Filename),
      contentType: normalizeString(row.DocumentOriginalType),
      isbn: extractIsbn(normalizeString(row.Title)) ?? extractIsbn(normalizeString(row.Filename))
    });
  }
}

function metadataTitle(documentId: string | null): string | null {
  if (!documentId) {
    return null;
  }

  return documentMetadata.get(documentId)?.title ?? null;
}

function upsertBook(input: {
  asin?: string | null;
  personalDocumentId?: string | null;
  nonAsinId?: string | null;
  title?: string | null;
  authors?: string[];
  seriesTitle?: string | null;
  seriesAuthor?: string | null;
  genres?: string[];
  tags?: string[];
  ownershipTypes?: string[];
  resourceType?: string | null;
  contentType?: string | null;
  marketplace?: string | null;
  isPersonalDocument?: boolean;
  fallback?: string | null;
  isbn?: string | null;
}): string {
  const documentId = input.personalDocumentId ?? input.nonAsinId ?? null;
  const metadata = documentId ? documentMetadata.get(documentId) : null;
  const resolvedTitle =
    metadata?.title && (input.title === null || input.title === undefined || input.title === "Untitled")
      ? metadata.title
      : input.title;
  const resolvedAuthors =
    metadata?.author && (!input.authors || input.authors.length === 0) ? [metadata.author] : input.authors;

  const id = toBookKey({
    asin: input.asin ?? null,
    personalDocumentId: input.personalDocumentId ?? null,
    nonAsinId: input.nonAsinId ?? null,
    title: input.title ?? null,
    fallback: input.fallback ?? null
  });

  const existing = books.get(id) ?? createEmptyBook(id);
  const next: NormalizedBook = {
    ...existing,
    // A placeholder title never replaces a real one, whichever export or dataset supplied it first.
    title:
      resolvedTitle && !(resolvedTitle === "Untitled" && existing.title !== "Untitled")
        ? resolvedTitle
        : existing.title,
    asin: input.asin ?? existing.asin,
    isbn: input.isbn ?? metadata?.isbn ?? existing.isbn,
    personalDocumentId: input.personalDocumentId ?? existing.personalDocumentId,
    nonAsinId: input.nonAsinId ?? existing.nonAsinId,
    authors: mergeUnique([...(existing.authors ?? []), ...(resolvedAuthors ?? [])]),
    seriesTitle: input.seriesTitle ?? existing.seriesTitle,
    seriesAuthor: input.seriesAuthor ?? existing.seriesAuthor,
    genres: mergeUnique([...(existing.genres ?? []), ...(input.genres ?? [])]),
    tags: mergeUnique([...(existing.tags ?? []), ...(input.tags ?? [])]),
    ownershipTypes: mergeUnique([...(existing.ownershipTypes ?? []), ...(input.ownershipTypes ?? [])]),
    resourceType: input.resourceType ?? existing.resourceType,
    contentType: input.contentType ?? metadata?.contentType ?? existing.contentType,
    marketplace: input.marketplace ?? existing.marketplace,
    isPersonalDocument: existing.isPersonalDocument || Boolean(input.isPersonalDocument),
    coverUrl: existing.coverUrl,
    coverSource: existing.coverSource
  };

  books.set(id, next);
  return id;
}

type ArchiveExtract = Omit<ExtractedData, "generatedAt" | "books">;

function extractArchive(): ArchiveExtract {
  const readingSessions: NormalizedReadingSession[] = [];
  const completions: NormalizedCompletion[] = [];
  const annotations: NormalizedAnnotation[] = [];
  const ownership: NormalizedOwnership[] = [];
  const recommendationEvents: RecommendationEvent[] = [];
  const mostRecentPageReadEvents: MostRecentPageReadEvent[] = [];
  const mostRecentPageReadDialogEvents: MostRecentPageReadDialogEvent[] = [];
  const bookOpenEvents: BookOpenEvent[] = [];
  const bookCloseEvents: BookCloseEvent[] = [];
  const annotationActionEvents: AnnotationActionEvent[] = [];
  const notebookActionEvents: NotebookActionEvent[] = [];
  const recommendationImpressionEvents: RecommendationImpressionEvent[] = [];
  const searchQueryEvents: SearchQueryEvent[] = [];
  const searchResultEvents: SearchResultEvent[] = [];
  const sendToKindleEvents: SendToKindleEvent[] = [];
  const bookRewardEvents: BookRewardEvent[] = [];
  const librarySnapshotEvents: LibrarySnapshotEvent[] = [];

  for (const row of readCsv(
    findFirstEntry("Kindle.reading-insights-sessions_with_adjustments.csv")
  )) {
    const asinCandidate = normalizeString(row.ASIN);
    const personalDocumentId = normalizeString(row.personal_document_id);
    const asin = looksLikeAsin(asinCandidate) ? asinCandidate : null;
    const bookId = upsertBook({
      asin,
      personalDocumentId,
      title: inferBookTitle({
        documentId: personalDocumentId,
        title: normalizeString(row.product_name),
        filename: documentMetadata.get(personalDocumentId ?? "")?.filename,
        author: documentMetadata.get(personalDocumentId ?? "")?.author ?? null
      }),
      marketplace: normalizeString(row.reading_marketplace),
      contentType: personalDocumentId ? "Personal Document" : "E-Book",
      isPersonalDocument: Boolean(personalDocumentId)
    });

    readingSessions.push({
      id: `reading-insights:${readingSessions.length + 1}`,
      bookId,
      source: "readingInsights",
      startTime: normalizeDate(row.start_time),
      endTime: normalizeDate(row.end_time),
      durationMs: normalizeNumber(row.total_reading_milliseconds) ?? 0,
      marketplace: normalizeString(row.reading_marketplace),
      deviceFamily: null,
      contentType: personalDocumentId ? "Personal Document" : "E-Book",
      pageFlips: null
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.Devices.ReadingSession.csv"))) {
    const asinCandidate = normalizeString(row.ASIN);
    const contentType = normalizeString(row.content_type);
    const isPersonalDocument = contentType === "Personal Document";
    const asin = !isPersonalDocument && looksLikeAsin(asinCandidate) ? asinCandidate : null;
    const nonAsinId = isPersonalDocument ? asinCandidate : null;
    const bookId = upsertBook({
      asin,
      nonAsinId,
      title: metadataTitle(nonAsinId),
      marketplace: normalizeString(row.preferred_marketplace) ?? normalizeString(row.purchased_marketplace),
      contentType,
      isPersonalDocument
    });

    readingSessions.push({
      id: `device-reading-session:${readingSessions.length + 1}`,
      bookId,
      source: "deviceReadingSession",
      startTime: normalizeDate(row.start_timestamp),
      endTime: normalizeDate(row.end_timestamp),
      durationMs: normalizeNumber(row.total_reading_millis) ?? 0,
      marketplace: normalizeString(row.preferred_marketplace) ?? normalizeString(row.purchased_marketplace),
      deviceFamily: normalizeString(row.device_family),
      contentType,
      pageFlips: normalizeNumber(row.number_of_page_flips)
    });
  }

  for (const path of findLibraryIndexEntries("CustomerRelationshipIndex")) {
    for (const row of readCsv(path)) {
      const asin = normalizeString(row.ASIN);
      upsertBook({
        asin: looksLikeAsin(asin) ? asin : null,
        title: normalizeString(row["Product Name"]) ?? "Untitled",
        authors: [normalizeString(row["Sortable Author Name"])].filter(Boolean) as string[],
        seriesTitle: normalizeString(row["Series Title"]),
        seriesAuthor: normalizeString(row["Series Author"]),
        ownershipTypes: [normalizeString(row["Ownership Type"])].filter(Boolean) as string[],
        marketplace: normalizeString(row.Marketplace)
      });
    }
  }

  for (const path of findLibraryIndexEntries("CustomerAuthorNameRelationship")) {
    for (const row of readCsv(path)) {
      const asin = normalizeString(row.ASIN);
      upsertBook({
        asin: looksLikeAsin(asin) ? asin : null,
        title: normalizeString(row["Product Name"]) ?? "Untitled",
        authors: [normalizeString(row["Author Name"])].filter(Boolean) as string[]
      });
    }
  }

  for (const path of findLibraryIndexEntries("CustomerGenres")) {
    for (const row of readCsv(path)) {
      const asin = normalizeString(row.ASIN);
      upsertBook({
        asin: looksLikeAsin(asin) ? asin : null,
        title: normalizeString(row["Product Name"]) ?? "Untitled",
        genres: [normalizeGenreLabel(row.Genre)].filter(Boolean) as string[]
      });
    }
  }

  for (const path of findLibraryIndexEntries("CustomerTags")) {
    for (const row of readCsv(path)) {
      const asin = normalizeString(row.ASIN);
      upsertBook({
        asin: looksLikeAsin(asin) ? asin : null,
        title: normalizeString(row["Product Name"]) ?? "Untitled",
        ownershipTypes: [normalizeString(row["Ownership Type"])].filter(Boolean) as string[],
        tags: [normalizeString(row["Tag Name"])].filter(Boolean) as string[]
      });
    }
  }

  for (const row of readCsv(findFirstEntry("Kindle.UserUniqueTitlesCompleted.csv"))) {
    const composite = normalizeString(row.asin_date_and_content_type);
    const personalDocumentId = normalizeString(row.personal_document_id);
    const compositeParts = composite?.split("_") ?? [];
    const asinCandidate = compositeParts[0] ?? null;
    const completedAt = compositeParts.length >= 2 ? normalizeDate(`${compositeParts[1]}T00:00:00Z`) : null;
    const asin = looksLikeAsin(asinCandidate) ? asinCandidate : null;
    const bookId = upsertBook({
      asin,
      personalDocumentId,
      title: inferBookTitle({
        documentId: personalDocumentId,
        title: normalizeString(row.product_name),
        filename: documentMetadata.get(personalDocumentId ?? "")?.filename,
        author: documentMetadata.get(personalDocumentId ?? "")?.author ?? null
      }),
      isPersonalDocument: Boolean(personalDocumentId)
    });

    completions.push({
      bookId,
      completedAt,
      source: "readingInsights"
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.Devices.autoMarkAsRead.csv"))) {
    const asinCandidate = normalizeString(row.active_ASIN);
    const contentType = normalizeString(row.content_type);
    const isPersonalDocument = contentType === "Personal Document";
    const bookId = upsertBook({
      asin: !isPersonalDocument && looksLikeAsin(asinCandidate) ? asinCandidate : null,
      nonAsinId: isPersonalDocument ? asinCandidate : null,
      title: metadataTitle(isPersonalDocument ? asinCandidate : null),
      contentType,
      marketplace: normalizeString(row.preferred_marketplace),
      isPersonalDocument
    });

    completions.push({
      bookId,
      completedAt: normalizeDate(row.created_timestamp),
      source: "autoMarkAsRead"
    });
  }

  for (const row of readCsv(findFirstEntry("Digital.Content.Whispersync/whispersync.csv"))) {
    if (normalizeBoolean(row["Is Deleted"]) === true) {
      continue;
    }

    const asinCandidate = normalizeString(row.ASIN);
    const nonAsinId = normalizeString(row["Non ASIN"]);
    const annotationType = normalizeString(row["Annotation Type"]) ?? "Unknown";
    const highlight = normalizeString(row.Highlight);
    const note = normalizeString(row.Note);
    const bookId = upsertBook({
      asin: looksLikeAsin(asinCandidate) ? asinCandidate : null,
      nonAsinId,
      title: inferBookTitle({
        documentId: nonAsinId,
        title: normalizeString(row["Product Name"]),
        filename: documentMetadata.get(nonAsinId ?? "")?.filename,
        author: documentMetadata.get(nonAsinId ?? "")?.author ?? null
      }),
      contentType: normalizeString(row.ContentType),
      isPersonalDocument: normalizeString(row.ContentType) === "PDOC"
    });

    annotations.push({
      bookId,
      annotationType,
      noteCount: note ? 1 : 0,
      highlightCount: highlight ? 1 : 0,
      lastUpdatedAt: normalizeDate(row.LastUpdatedDate) ?? normalizeDate(row["Customer modified date on device"])
    });
  }

  for (const entryName of findAllEntries(".json").filter((entryName) =>
    entryName.startsWith("Digital.Content.Ownership/")
  )) {
    const payload = readJson(entryName) as {
      rights?: Array<{
        rightType?: string;
        rightStatus?: string;
        origin?: { originType?: string };
        acquiredDate?: string;
      }>;
      lastUpdatedDate?: string;
      resource?: {
        ASIN?: string;
        ["Product Name"]?: string;
        resourceType?: string;
      };
    };

    const asinCandidate = normalizeString(payload.resource?.ASIN);
    const resourceType = normalizeString(payload.resource?.resourceType);
    const isPersonalDocument = resourceType === "KindlePDoc";
    const bookId = upsertBook({
      asin: looksLikeAsin(asinCandidate) ? asinCandidate : null,
      title: normalizeString(payload.resource?.["Product Name"]) ?? "Untitled",
      resourceType,
      isPersonalDocument,
      fallback: entryName
    });

    for (const right of payload.rights ?? []) {
      ownership.push({
        bookId,
        rightType: normalizeString(right.rightType),
        rightStatus: normalizeString(right.rightStatus),
        originType: normalizeString(right.origin?.originType),
        acquiredDate: normalizeDate(right.acquiredDate),
        lastUpdatedDate: normalizeDate(payload.lastUpdatedDate),
        resourceType
      });
    }
  }

  for (const row of readCsv(findFirstEntry("Kindle.KindleHome.CardViewsOnKindleForAndroidV2.csv"))) {
    recommendationEvents.push({
      id: `view:${recommendationEvents.length + 1}`,
      kind: "view",
      asin: null,
      cardName: normalizeString(row.card_name),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      deviceFamily: normalizeString(row.device_family),
      cardPosition: normalizeNumber(row.card_position),
      itemPositionWithinCard: null
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.KindleHome.CardClicksOnKindleForAndroidV2.csv"))) {
    const asin = normalizeString(row.item_clicked_on_ASIN);
    if (looksLikeAsin(asin)) {
      upsertBook({
        asin,
        title: null
      });
    }

    recommendationEvents.push({
      id: `click:${recommendationEvents.length + 1}`,
      kind: "click",
      asin: looksLikeAsin(asin) ? asin : null,
      cardName: normalizeString(row.card_name),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      deviceFamily: normalizeString(row.device_family),
      cardPosition: normalizeNumber(row.card_position),
      itemPositionWithinCard: normalizeNumber(row.item_position_within_card)
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.MostRecentPageReadActionPerformed_v1.csv", "Kindle.Devices.MostRecentPageReadActionPerformed.csv")
  )) {
    mostRecentPageReadEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      customerAction: normalizeString(row.customer_action),
      desiredPageLocation: normalizeString(row.desired_page_location)
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.MostRecentPageRead.Dialog.Actions_v1.csv", "Kindle.Devices.MostRecentPageRead.Dialog.Actions.csv")
  )) {
    mostRecentPageReadDialogEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      pageWhereDialogWasShown: normalizeString(row.page_where_dialog_was_shown),
      customerAction: normalizeString(row.customer_action),
      pagesSwipedWhileDialogShown: normalizeNumber(row.number_of_pages_swiped_while_dialog_is_displayed)
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.EreaderOpenBook_v1.csv", "Kindle.Devices.EreaderOpenBook.csv")
  )) {
    bookOpenEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row["Preferred Marketplace"]),
        contentType: normalizeString(row["Book Format"]),
        isPersonalDocument: normalizeString(row["Book Category"]) === "Personal Documents"
      }),
      createdAt: normalizeDate(row["Created Timestamp"]),
      marketplace: normalizeString(row["Preferred Marketplace"]),
      country: normalizeString(row["Country of Residence"]),
      deviceFamily: normalizeString(row["Device Family"]),
      bookFormat: normalizeString(row["Book Format"]),
      bookCategory: normalizeString(row["Book Category"]),
      loadMethod: normalizeString(row["Load Method"]),
      contentLanguage: normalizeString(row["Content Language"]),
      isContentDownloaded: normalizeBoolean(row["Is Content Downloaded"])
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.EreaderCloseBook_v1.csv", "Kindle.Devices.EreaderCloseBook.csv")
  )) {
    bookCloseEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row["Preferred Marketplace"])
      }),
      createdAt: normalizeDate(row["Created Timestamp"]),
      closedAt: normalizeDate(row["Close Timestamp"]),
      marketplace: normalizeString(row["Preferred Marketplace"]),
      country: normalizeString(row["Country of Residence"]),
      deviceFamily: normalizeString(row["Device Family"]),
      closeMethod: normalizeString(row["Close Method"])
    });
  }

  // Versioned exports repeat the same annotation events in each schema version, so only the newest one is read.
  const annotationActionsEntry = findFirstEntry(
    "Kindle.Devices.EinkAnnotationActionsV2.csv",
    "Kindle.Devices.EinkAnnotationActionsV2_v5.csv",
    "Kindle.Devices.EReaderAnnotationActions_v3.csv",
    "Kindle.Devices.EinkAnnotationActionsV2_v1.csv",
    "Kindle.Devices.EReaderAnnotationActions_v2.csv"
  );

  for (const row of readCsv(annotationActionsEntry)) {
    annotationActionEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row["Preferred Marketplace"] ?? row["Preferred Marketplace Id"])
      }),
      createdAt: normalizeDate(row["Created Timestamp"]),
      marketplace: normalizeString(row["Preferred Marketplace"] ?? row["Preferred Marketplace Id"]),
      country: normalizeString(row["Country of Residence"] ?? row.Country),
      deviceFamily: normalizeString(row["Device Family"]),
      action: normalizeString(row.Action),
      annotationType: normalizeString(row["Annotation Type"]),
      startPosition: normalizeString(row["Start Position"] ?? row["Note Start Position"]),
      totalAnnotations: normalizeNumber(row["Total Number of Annotations"] ?? row["Annotations Made (Total Count)"]),
      highlightsCount: normalizeNumber(row["Highlights Count"] ?? row["Highlight Annotations (Total Count)"]),
      textNotesCount: normalizeNumber(row["Text Notes Count"] ?? row["Text Notes (Total Count)"]),
      inlineNotesCount: normalizeNumber(row["On Page Note Count"] ?? row["Inline Notes (Total Count)"]),
      handwrittenStickyNotesCount: normalizeNumber(
        row["Handwritten Sticky Note Count"] ?? row["Handwritten Sticky Notes (Total Count)"]
      ),
      underlineCount: normalizeNumber(row["Underline Annotations (Total Count)"]),
      bookmarkCount: normalizeNumber(row["Bookmarks (Total Count)"]),
      annotationColor: normalizeString(row["Annotation Color"]),
      stickyNoteWindowSeconds: normalizeNumber(
        row["Time on Sticky Note Window"] ?? row["Total Time Spent On Sticky Note Window (In Seconds)"]
      ),
      source: "annotation-actions"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.kindleHighlightActions_v1.csv", "Kindle.Devices.kindleHighlightActions.csv")
  )) {
    annotationActionEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      action: normalizeString(row.action),
      annotationType: "Highlight",
      startPosition: null,
      totalAnnotations: null,
      highlightsCount: 1,
      textNotesCount: 0,
      inlineNotesCount: 0,
      handwrittenStickyNotesCount: 0,
      underlineCount: 0,
      bookmarkCount: 0,
      annotationColor: normalizeString(row.highlight_color),
      stickyNoteWindowSeconds: null,
      source: "kindle-highlight-actions"
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.Devices.NotebookActions.csv"))) {
    notebookActionEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country_code),
      deviceFamily: normalizeString(row.device_family),
      action: normalizeString(row.action),
      entryPoint: normalizeString(row["Entry Point"]),
      source: "notebook-actions"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.kindleNotebookActions_v1.csv", "Kindle.Devices.kindleNotebookActions.csv")
  )) {
    notebookActionEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country_code),
      deviceFamily: normalizeString(row.device_family),
      action: normalizeString(row.action),
      entryPoint: null,
      source: "kindle-notebook-actions"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.NotebookActionE2e_v1.csv", "Kindle.Devices.NotebookActionE2e.csv")
  )) {
    notebookActionEvents.push({
      bookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      action: "NotebookActionE2E",
      entryPoint: null,
      source: "notebook-e2e"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Ads.or.Recommendations.Info_v1.csv", "Kindle.Ads.or.Recommendations.Info.csv")
  )) {
    recommendationImpressionEvents.push({
      contextBookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      recommendedBookId: toBookIdFromContentId(row.ads_or_recommendations_asin, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      location: normalizeString(row.ad_or_recommendation_location),
      position: normalizeString(row.ad_or_recommendation_position),
      recommendationType: normalizeString(row.ads_or_recommendations_type),
      source: "ads-or-recommendations-info"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.Ad.and.Recommendations.ClickMetric_v1.csv", "Kindle.Devices.Ad.and.Recommendations.ClickMetric.csv")
  )) {
    recommendationImpressionEvents.push({
      contextBookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      recommendedBookId: toBookIdFromContentId(row.clicked_ad_or_recommendation_asin, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      location: normalizeString(row.ad_or_recomendation_location),
      position: normalizeString(row.ad_or_recommendation_position),
      recommendationType: normalizeString(row.ad_or_recommendation_type),
      source: "ad-recommendation-click-metric"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.HomeImpressionsFos_v1.csv", "Kindle.Devices.HomeImpressionsFos.csv")
  )) {
    recommendationImpressionEvents.push({
      contextBookId: toBookIdFromContentId(row.ASIN, {
        title: null,
        marketplace: normalizeString(row.preferred_marketplace)
      }),
      recommendedBookId: null,
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      location: normalizeString(row.card_name),
      position: normalizeString(row.card_position),
      recommendationType: "home-impression",
      source: "home-impressions-fos"
    });
  }

  // Unversioned exports ship a single search-general file whose schema matches either v2 (with query text) or v4.
  const unversionedSearchRows = readCsv(findFirstEntry("Kindle.Devices.KindleAppSearchEventGeneral.csv"));
  const unversionedSearchHasQueries = unversionedSearchRows.length > 0 && "Search Query" in unversionedSearchRows[0];

  for (const row of readCsv(findFirstEntry("Kindle.Devices.KindleAppSearchEventGeneral_v2.csv")).concat(
    unversionedSearchHasQueries ? unversionedSearchRows : []
  )) {
    searchQueryEvents.push({
      createdAt: normalizeDate(row["Created Time"]),
      marketplace: normalizeString(row["Preferred Marketplace"]),
      country: normalizeString(row.Country),
      deviceFamily: normalizeString(row["Device Family"]),
      query: normalizeString(row["Search Query"]),
      searchId: normalizeString(row["Search ID"]),
      searchSessionId: normalizeString(row["Search Session ID"]),
      spellCorrectedKeyword: normalizeString(row["Spell Corrected Keyword"]),
      suggestions: normalizeString(row["Search Suggestions"]),
      entryLocation: normalizeString(row["Search Entry Location"]),
      refinements: normalizeString(row.Refinements),
      source: "kindle-app-search-general-v2"
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.Devices.KindleAppSearchEventGeneral_v4.csv")).concat(
    unversionedSearchHasQueries ? [] : unversionedSearchRows
  )) {
    searchQueryEvents.push({
      createdAt: normalizeDate(row.created_timestamp),
      marketplace: normalizeString(row.preferred_marketplace),
      country: normalizeString(row.country),
      deviceFamily: normalizeString(row.device_family),
      query: null,
      searchId: null,
      searchSessionId: null,
      spellCorrectedKeyword: null,
      suggestions: null,
      entryLocation: null,
      refinements: null,
      source: "kindle-app-search-general-v4"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.KindleAppSearchEventOutcome_v2.csv", "Kindle.Devices.KindleAppSearchEventOutcome.csv")
  )) {
    searchResultEvents.push({
      createdAt: normalizeDate(row["Created Timestamp"]),
      marketplace: normalizeString(row["Preferred Marketplace"]),
      country: normalizeString(row["Country Of Residence"]),
      deviceFamily: normalizeString(row["Device Family"]),
      searchId: normalizeString(row["Search ID"]),
      searchSessionId: normalizeString(row["Search Session ID"]),
      sectionName: normalizeString(row["Search Result Section Position Shown"]),
      resultPosition: normalizeNumber(row["Search Result Selected Position"]),
      selectedValue: normalizeString(row["Selected Search Result Value"]),
      selectedBookId: toBookIdFromContentId(row["Selected Search Result Value"], {
        title: null,
        marketplace: normalizeString(row["Preferred Marketplace"])
      }),
      searchOutcome: normalizeString(row["Search Outcome"]),
      searchOutcomeType: normalizeString(row["Search Outcome Type"]),
      progressPercent: null,
      reviewStars: null,
      totalReviews: normalizeNumber(row["Total Store Search Results Found"]),
      wasDownloaded: null,
      source: "kindle-app-search-outcome-v2"
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.KindleAppSearchEventSectionAsin_v3.csv", "Kindle.Devices.KindleAppSearchEventSectionAsin.csv")
  )) {
    searchResultEvents.push({
      createdAt: normalizeDate(row["Created Timestamp"]),
      marketplace: normalizeString(row.Marketplace),
      country: normalizeString(row["Country of Residence"]),
      deviceFamily: normalizeString(row["Device Family"]),
      searchId: normalizeString(row["Search ID"]),
      searchSessionId: normalizeString(row["Search Session ID"]),
      sectionName: normalizeString(row["Section Name"]),
      resultPosition: normalizeNumber(row["Search Result Position"]),
      selectedValue: normalizeString(row["Selected Search Result Value"]),
      selectedBookId: toBookIdFromContentId(row["Selected Search Result Value"], {
        title: null,
        marketplace: normalizeString(row.Marketplace)
      }),
      searchOutcome: null,
      searchOutcomeType: normalizeString(row["Book Type"]),
      progressPercent: normalizeNumber(row["Book Read Progress Percentage"]),
      reviewStars: normalizeNumber(row["Review Stars (5 is best)"]),
      totalReviews: normalizeNumber(row["Total Reviews"]),
      wasDownloaded: normalizeBoolean(row["Book Was Downloaded"]),
      source: "kindle-app-search-section-asin-v3"
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.SendToKindleEvents.csv"))) {
    sendToKindleEvents.push({
      requestStartedAt: normalizeDate(row["Send to Kindle Request Start Time"]),
      deliveredAt: normalizeDate(row["Document Delivery End Time"]),
      channel: normalizeString(row.Channel),
      deliveryStatus: normalizeString(row["Delivery Status"]),
      fileSizeBytes: normalizeNumber(row["File Size (In Bytes)"]),
      fileType: normalizeString(row["File Type"]),
      marketplace: normalizeString(row["Preferred Amazon Marketplace"]),
      appName: normalizeString(row["App Name"]),
      appVersion: normalizeString(row["App Version"]),
      operatingSystem: normalizeString(row["Operating System"]),
      operatingSystemArchitecture: normalizeString(row["Operating System Architecture"])
    });
  }

  for (const row of readCsv(findFirstEntry("Kindle.BookRewards.Achievements.2.csv"))) {
    bookRewardEvents.push({
      achievementGroupName: normalizeString(row.AchievementGroupName),
      achievementName: normalizeString(row.AchievementName),
      earnedAt: normalizeDate(row.EarnDate),
      marketplace: normalizeString(row.Marketplace),
      quantity: normalizeNumber(row.Quantity)
    });
  }

  for (const row of readCsv(
    findFirstEntry("Kindle.Devices.KindleMetricsLibrarySize_v2.csv", "Kindle.Devices.KindleMetricsLibrarySize.csv")
  )) {
    librarySnapshotEvents.push({
      createdAt: normalizeDate(row["Created Timestamp"]),
      marketplace: normalizeString(row["Preferred Marketplace"]),
      country: normalizeString(row["Country of Residence"]),
      deviceFamily: normalizeString(row["Device Family"]),
      platform: normalizeString(row.platform),
      totalItems: normalizeNumber(row["Total Items"]),
      numberOfBooks: normalizeNumber(row["Number of Books"]),
      numberOfDocuments: normalizeNumber(row["Number of Documents"]),
      numberOfItemsRead: normalizeNumber(row["Number of Items read"]),
      numberOfItemsUnread: normalizeNumber(row["Number of Items unread"]),
      numberOfItemsDownloaded: normalizeNumber(row["Number of items downloaded"])
    });
  }

  const readingTrackedDays = readCsv(findFirstEntry("Kindle.ReadingInsightsDayUnits.csv"))
    .map((row) => normalizeDate(row.reading_tracked_on_day))
    .filter((value): value is string => Boolean(value));

  const readerProfileRow = readCsv(findFirstEntry("Kindle.ReadingBehaviorCounts.csv"))[0];
  const readerProfile: ReaderProfileSnapshot | null = readerProfileRow
    ? {
        marketplace: normalizeString(readerProfileRow.Marketplace),
        averageMonthlyReadingDays: normalizeNumber(readerProfileRow["Average Monthly Reading (Days TTM)"]) ?? 0,
        asinCount: normalizeNumber(readerProfileRow["ASIN Count"]) ?? 0,
        averagePercentReadCompletion:
          normalizeNumber(readerProfileRow["Average Percent Read Completion"]) ?? 0,
        highestPercentReadCompletion:
          normalizeNumber(readerProfileRow["Highest Percent Read Completion"]) ?? 0,
        fictionPercentage: normalizeNumber(readerProfileRow["Books Read Percentage (Fiction Genre)"]),
        nonfictionPercentage: normalizeNumber(readerProfileRow["Books Read Percentage (Nonfiction Genre)"]),
        scienceFictionFantasyPercentage: normalizeNumber(
          readerProfileRow["Books Read Percentage (Science Fiction and Fantasy Genre)"]
        ),
        selfHelpPercentage: normalizeNumber(readerProfileRow["Books Read Percentage (Self Help Genre)"]),
        snapshotDate: normalizeDate(readerProfileRow["Snapshot Date (in UTC)"])
      }
    : null;

  return {
    readingSessions,
    completions,
    annotations,
    ownership,
    recommendationEvents,
    mostRecentPageReadEvents,
    mostRecentPageReadDialogEvents,
    bookOpenEvents,
    bookCloseEvents,
    annotationActionEvents,
    notebookActionEvents,
    recommendationImpressionEvents,
    searchQueryEvents,
    searchResultEvents,
    sendToKindleEvents,
    bookRewardEvents,
    librarySnapshotEvents,
    readingTrackedDays,
    readerProfile
  };
}

function recordKey(record: unknown): string {
  if (record === null || typeof record !== "object") {
    return JSON.stringify(record);
  }

  const { id: _id, ...content } = record as { id?: unknown };
  return JSON.stringify(content);
}

// Exports overlap, and device telemetry only covers a rolling window, so events are unioned across exports.
// Identical records count once, keeping the most repeats any single export has, so genuine repeats survive.
function mergeEvents<T>(perArchive: T[][]): T[] {
  const emitted = new Map<string, number>();
  const merged: T[] = [];

  for (const records of perArchive) {
    const seen = new Map<string, number>();
    for (const record of records) {
      const key = recordKey(record);
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);

      if (occurrence > (emitted.get(key) ?? 0)) {
        emitted.set(key, occurrence);
        merged.push(record);
      }
    }
  }

  return merged;
}

// Per-export ids are positional, so they are reassigned after merging.
function renumber<T extends { id: string }>(records: T[]): T[] {
  return records.map((record, index) => ({
    ...record,
    id: `${record.id.slice(0, record.id.indexOf(":"))}:${index + 1}`
  }));
}

// Older exports log each search twice at the same timestamp: with query text (v2) and without it (v4).
function dropShadowedSearches(events: SearchQueryEvent[]): SearchQueryEvent[] {
  const searchKey = (event: SearchQueryEvent) => `${event.createdAt}|${event.deviceFamily}`;
  const withQueryText = new Set(
    events.filter((event) => event.source === "kindle-app-search-general-v2").map(searchKey)
  );

  return events.filter(
    (event) => event.source !== "kindle-app-search-general-v4" || !withQueryText.has(searchKey(event))
  );
}

const extracts = archives.map((archive) => {
  useArchive(archive);
  return extractArchive();
});
const latestExtract = extracts[extracts.length - 1];

function mergedEvents<T>(select: (extract: ArchiveExtract) => T[]): T[] {
  return mergeEvents(extracts.map(select));
}

const extractedData: ExtractedData = {
  generatedAt: new Date().toISOString(),
  books: [...books.values()].sort((left, right) => left.title.localeCompare(right.title)),
  readingSessions: renumber(mergedEvents((extract) => extract.readingSessions)),
  completions: mergedEvents((extract) => extract.completions),
  // Highlights and ownership describe current state (deletions, returns), which only the newest export reflects.
  annotations: latestExtract.annotations,
  ownership: latestExtract.ownership,
  recommendationEvents: renumber(mergedEvents((extract) => extract.recommendationEvents)),
  mostRecentPageReadEvents: mergedEvents((extract) => extract.mostRecentPageReadEvents),
  mostRecentPageReadDialogEvents: mergedEvents((extract) => extract.mostRecentPageReadDialogEvents),
  bookOpenEvents: mergedEvents((extract) => extract.bookOpenEvents),
  bookCloseEvents: mergedEvents((extract) => extract.bookCloseEvents),
  annotationActionEvents: mergedEvents((extract) => extract.annotationActionEvents),
  notebookActionEvents: mergedEvents((extract) => extract.notebookActionEvents),
  recommendationImpressionEvents: mergedEvents((extract) => extract.recommendationImpressionEvents),
  searchQueryEvents: dropShadowedSearches(mergedEvents((extract) => extract.searchQueryEvents)),
  searchResultEvents: mergedEvents((extract) => extract.searchResultEvents),
  sendToKindleEvents: mergedEvents((extract) => extract.sendToKindleEvents),
  bookRewardEvents: mergedEvents((extract) => extract.bookRewardEvents),
  librarySnapshotEvents: mergedEvents((extract) => extract.librarySnapshotEvents),
  readingTrackedDays: mergedEvents((extract) => extract.readingTrackedDays),
  readerProfile: [...extracts].reverse().find((extract) => extract.readerProfile)?.readerProfile ?? null
};

writeJson("books.json", extractedData.books);
writeJson("reading_sessions.json", extractedData.readingSessions);
writeJson("book_completion.json", extractedData.completions);
writeJson("book_annotations.json", extractedData.annotations);
writeJson("book_ownership.json", extractedData.ownership);
writeJson("recommendation_events.json", extractedData.recommendationEvents);
writeJson("most_recent_page_read_events.json", extractedData.mostRecentPageReadEvents);
writeJson("most_recent_page_read_dialog_events.json", extractedData.mostRecentPageReadDialogEvents);
writeJson("book_open_events.json", extractedData.bookOpenEvents);
writeJson("book_close_events.json", extractedData.bookCloseEvents);
writeJson("annotation_action_events.json", extractedData.annotationActionEvents);
writeJson("notebook_action_events.json", extractedData.notebookActionEvents);
writeJson("recommendation_impression_events.json", extractedData.recommendationImpressionEvents);
writeJson("search_query_events.json", extractedData.searchQueryEvents);
writeJson("search_result_events.json", extractedData.searchResultEvents);
writeJson("send_to_kindle_events.json", extractedData.sendToKindleEvents);
writeJson("book_reward_events.json", extractedData.bookRewardEvents);
writeJson("library_snapshot_events.json", extractedData.librarySnapshotEvents);
writeJson("reading_tracked_days.json", extractedData.readingTrackedDays);
writeJson("reader_profile.json", extractedData.readerProfile);
writeJson("extracted.json", extractedData);

console.log(`Merged ${archives.length} export(s): ${archives.map((archive) => basename(archive.path)).join(", ")}`);
console.log(
  `Extracted ${extractedData.books.length} books, ${extractedData.readingSessions.length} sessions, ` +
    `${extractedData.completions.length} completions, ${extractedData.annotations.length} annotations.`
);
