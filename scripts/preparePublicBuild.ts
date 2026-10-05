import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { toPublicDataset, type ReadingDataset } from "../src/lib/readingDataset";

// Runs after `vite build`: dist/processed ends up holding only the public copy of reading.json.
const workspaceRoot = process.cwd();
const distProcessedDir = join(workspaceRoot, "dist", "processed");
const datasetPath = join(workspaceRoot, "data", "processed", "reading.json");
const overridesPath = join(workspaceRoot, "data", "raw", "book-overrides.json");

if (!existsSync(join(workspaceRoot, "dist", "index.html"))) {
  throw new Error("dist/ is missing. Run `bun run build:public`, which builds the app first.");
}
if (!existsSync(datasetPath)) {
  throw new Error("data/processed/reading.json is missing. Run `bun run ingest` first.");
}

const dataset = (await Bun.file(datasetPath).json()) as ReadingDataset;
const overrides = existsSync(overridesPath)
  ? ((await Bun.file(overridesPath).json()) as { byBookId?: Record<string, { hidden?: boolean }> })
  : {};
const hiddenBookIds = new Set(
  Object.entries(overrides.byBookId ?? {})
    .filter(([, override]) => override.hidden === true)
    .map(([bookId]) => bookId)
);

const publicDataset = toPublicDataset(dataset, hiddenBookIds);

rmSync(distProcessedDir, { recursive: true, force: true });
mkdirSync(distProcessedDir, { recursive: true });
await Bun.write(join(distProcessedDir, "reading.json"), JSON.stringify(publicDataset));

const sourceMarker = /anna.?s archive|z-?lib|libgen|pdfdrive|oceanofpdf|\.(epub|pdf|azw\d*|mobi)\b/i;
const suspiciousTitles = publicDataset.books.filter((book) => sourceMarker.test(book.title));

console.log(
  `Public build ready in dist/: ${publicDataset.books.length} books (${dataset.books.length - publicDataset.books.length} hidden), ` +
    `data through ${publicDataset.lastDay}, times in ${publicDataset.timeZone}.`
);
if (suspiciousTitles.length > 0) {
  console.warn("These titles look like file names or source tags; fix or hide them in data/raw/book-overrides.json:");
  for (const book of suspiciousTitles) {
    const original = dataset.books.find((entry) => entry.title === book.title);
    console.warn(`  ${original?.id ?? book.id}: ${book.title}`);
  }
}
