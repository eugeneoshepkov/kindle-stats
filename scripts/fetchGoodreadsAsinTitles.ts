import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type GoodreadsAsinCache,
  goodreadsHtmlDeclaresKindleAsin,
  isGoodreadsAsinMissPage,
  kindleStoreAsinKey,
  parseGoodreadsBookFromHtml
} from "../src/lib/goodreadsAsin";
import type { ExtractedData } from "../src/lib/types";

const workspaceRoot = process.cwd();
const processedDir = join(workspaceRoot, "data", "processed");
const extractedPath = join(processedDir, "extracted.json");
const cachePath = join(processedDir, "goodreads_asin_cache.json");

mkdirSync(processedDir, { recursive: true });

const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function parseArgs(): { refresh: boolean; limit: number | null; delayMs: number } {
  let refresh = false;
  let limit: number | null = null;
  let delayMs = 850;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--refresh") {
      refresh = true;
    } else if (arg.startsWith("--limit=")) {
      limit = Math.max(0, Number(arg.slice("--limit=".length)) || 0);
    } else if (arg.startsWith("--delay-ms=")) {
      delayMs = Math.max(0, Number(arg.slice("--delay-ms=".length)) || 850);
    }
  }

  return { refresh, limit, delayMs };
}

async function readJsonIfExists<T>(path: string, fallback: T): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return fallback;
  }
  return (await file.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logProgress(message: string): void {
  const line = `[goodreads-asins] ${message}\n`;
  process.stderr.write(line);
}

async function fetchGoodreadsByAsin(asin: string): Promise<Response> {
  const url = `https://www.goodreads.com/book/isbn/${encodeURIComponent(asin)}`;
  return fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9"
    },
    redirect: "follow"
  });
}

const { refresh, limit, delayMs } = parseArgs();
logProgress(`reading ${extractedPath} (large files may take a minute before the next line)...`);

const extracted = (await Bun.file(extractedPath).json()) as ExtractedData;
logProgress(`loaded ${extracted.books.length} books from extract`);

const asins = new Set<string>();
for (const book of extracted.books) {
  if (book.title !== "Untitled") {
    continue;
  }
  const key = kindleStoreAsinKey(book);
  if (key) {
    asins.add(key);
  }
}

let cache = await readJsonIfExists<GoodreadsAsinCache>(cachePath, {});
const list = [...asins].sort();
const toFetch = refresh ? list : list.filter((asin) => !cache[asin]);
const capped = limit != null && limit > 0 ? toFetch.slice(0, limit) : toFetch;
const skippedBecauseCached = refresh ? 0 : list.length - toFetch.length;

logProgress(
  `Untitled rows with Kindle store asin field: ${list.length} (${skippedBecauseCached} already in cache and skipped${refresh ? "; --refresh: re-fetching all" : ""}; personal-doc ids are skipped — they are not Amazon ASINs)`
);
logProgress(`will fetch ${capped.length} this run; delay ${delayMs}ms between requests`);

if (capped.length === 0) {
  logProgress("nothing to do.");
  console.log(
    `Goodreads ASIN cache: ${Object.keys(cache).length} total entries; 0 fetched (use --refresh to rebuild).`
  );
  process.exit(0);
}

const approxSec = Math.ceil((capped.length * Math.max(delayMs, 500)) / 1000);
logProgress(`rough ETA ~${approxSec}s of inter-request delay + response time`);

let ok = 0;
let miss = 0;
let fail = 0;

for (let i = 0; i < capped.length; i += 1) {
  const asin = capped[i];
  const n = i + 1;
  logProgress(`[${n}/${capped.length}] ${asin} requesting...`);
  try {
    const response = await fetchGoodreadsByAsin(asin);
    const html = await response.text();
    const notOk = !response.ok || isGoodreadsAsinMissPage(html);

    if (notOk) {
      cache = {
        ...cache,
        [asin]: { miss: true, fetchedAt: new Date().toISOString() }
      };
      miss += 1;
      logProgress(`[${n}/${capped.length}] ${asin} miss (HTTP ${response.status} or not-found page)`);
    } else if (!goodreadsHtmlDeclaresKindleAsin(html, asin)) {
      cache = {
        ...cache,
        [asin]: { miss: true, fetchedAt: new Date().toISOString() }
      };
      miss += 1;
      logProgress(
        `[${n}/${capped.length}] ${asin} miss (page did not embed this ASIN — not trusting title)`
      );
    } else {
      const parsed = parseGoodreadsBookFromHtml(html);
      if (parsed?.title) {
        cache = {
          ...cache,
          [asin]: {
            title: parsed.title,
            authors: parsed.authors,
            ...(parsed.coverUrl ? { coverUrl: parsed.coverUrl } : {}),
            fetchedAt: new Date().toISOString()
          }
        };
        ok += 1;
        const short =
          parsed.title.length > 72 ? `${parsed.title.slice(0, 69)}...` : parsed.title;
        logProgress(`[${n}/${capped.length}] ${asin} ok — ${short}`);
      } else {
        cache = {
          ...cache,
          [asin]: { miss: true, fetchedAt: new Date().toISOString() }
        };
        miss += 1;
        logProgress(`[${n}/${capped.length}] ${asin} miss (could not parse title from page)`);
      }
    }
  } catch (err) {
    fail += 1;
    logProgress(
      `[${n}/${capped.length}] ${asin} error — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (i < capped.length - 1) {
    logProgress(`[${n}/${capped.length}] sleeping ${delayMs}ms...`);
    await sleep(delayMs);
  }
}

logProgress(`writing ${cachePath}...`);
await Bun.write(cachePath, JSON.stringify(cache, null, 2));
console.log(
  `Goodreads ASIN cache: ${Object.keys(cache).length} total entries; fetched ${capped.length} (${ok} ok, ${miss} miss, ${fail} errors).`
);
