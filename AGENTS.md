# Kindle Stats Agent Notes

## Data Source

This project is built from Amazon's Kindle export archive, typically downloaded from the Amazon "Request your data" / privacy export flow.

The primary input file expected by the scripts is:

- `Amazon Kindle Data.zip`

The app also uses:

- `Amazon Data Descriptions.csv`

That CSV is not user reading history itself; it is a reference file that helps explain Amazon export datasets.

## What The Archive Contains

`Amazon Kindle Data.zip` is a mixed export with many CSV and JSON files. Only some of them are directly useful for reading analytics. The project currently parses Kindle-specific datasets for:

- document metadata
- reading sessions
- book ownership
- completions / mark-as-read signals
- annotations and notebook behavior
- recommendation views, clicks, and impressions
- search and discovery signals
- Send to Kindle deliveries
- Kindle challenge / rewards events
- library snapshot metrics
- reading day and reader profile summaries

## Main Parsed File Families

Important archive members currently used by the pipeline include:

- `Kindle.KindleDocs.DocumentMetadata.csv`
- `Kindle.reading-insights-sessions_with_adjustments.csv`
- `Kindle.Devices.ReadingSession.csv`
- `Kindle.UserUniqueTitlesCompleted.csv`
- `Kindle.Devices.autoMarkAsRead.csv`
- `Digital.Content.Whispersync/whispersync.csv`
- `Digital.Content.Ownership/*.json`
- `Kindle.ReadingInsightsDayUnits.csv`
- `Kindle.ReadingBehaviorCounts.csv`
- `Kindle.KindleHome.CardViewsOnKindleForAndroidV2.csv`
- `Kindle.KindleHome.CardClicksOnKindleForAndroidV2.csv`
- `Kindle.Ads.or.Recommendations.Info_v1/...csv`
- `Kindle.Devices.MostRecentPageReadActionPerformed_v1/...csv`
- `Kindle.Devices.MostRecentPageRead.Dialog.Actions_v1/...csv`
- `Kindle.Devices.EreaderOpenBook_v1/...csv`
- `Kindle.Devices.EreaderCloseBook_v1/...csv`
- `Kindle.Devices.EReaderAnnotationActions_v2/...csv`
- `Kindle.Devices.EReaderAnnotationActions_v3/...csv`
- `Kindle.Devices.NotebookActions/...csv`
- `Kindle.Devices.kindleNotebookActions_v1/...csv`
- `Kindle.Devices.KindleAppSearchEventGeneral_v2/...csv`
- `Kindle.Devices.KindleAppSearchEventOutcome_v2/...csv`
- `Kindle.Devices.KindleAppSearchEventSectionAsin_v3/...csv`
- `Kindle.SendToKindleEvents/...csv`
- `Kindle.BookRewards.Achievements.2/...csv`
- `Kindle.Devices.KindleMetricsLibrarySize_v2/...csv`

Naming varies between exports. Older exports use versioned names (`..._v1.csv`) and region-suffixed library index files (`_FRA`, `_ZAZ`); newer exports (from 2026-10 on) drop the `_vN` suffix and number the library index files (`.1.1`, `.2.1`). The extractor accepts both. Device telemetry (recommendation impressions, annotation actions, notebook actions, Send to Kindle, search results) is a rolling window, so a newer export does not contain all the history of an older one, and newer exports omit search query text. That is why the extractor merges every export it is given (see below).

## Processed Outputs

The scripts normalize those raw export members into local JSON artifacts under:

- `data/processed/`
- `public/processed/`

The main generated files are:

- `extracted.json`: every parsed dataset, merged across exports
- `reading.json`: the only file the dashboard UI reads (see below)
- `dashboard.json`, `recommendations.json`, `analytics_summary.json`: older pre-aggregated outputs; local only (not copied to `public/`), not used by the UI

Additional event-level JSON files are also written for specific analytics families, such as search, resume/open events, notebook actions, and Send to Kindle history.

## Dashboard Data (`reading.json`)

`buildDerivedMetrics.ts` writes `reading.json` via `src/lib/readingDataset.ts`. It holds every book you opened or finished (resolved title, authors, cover, finish dates, highlight and sitting counts), reading time per book per day, and per-period habit summaries (weekday x hour grid, sitting-length bins). Everything is aggregated in the reader's time zone (`READING_TIME_ZONE`, default: the machine's zone), so every visitor sees the reader's own clock, and the file holds no session timestamps.

Reading time comes from **one** session source. Kindle logs the same reading twice, in `Kindle.reading-insights-sessions_with_adjustments.csv` and in `Kindle.Devices.ReadingSession.csv`, so summing both doubles every total. Reading Insights is the source of truth; device sessions only fill the day or so after its last session. Highlights count only `kindle.highlight` rows in Whispersync; most Whispersync rows are sync markers (last read position and similar), not annotations.

The UI has four views: Overview (period stats, monthly chart, calendar, currently reading, year by year), Books (search, filter, sort, per-book detail), Habits (weekday x hour, sitting length) and Finished (by year). Reading fragments less than 10 minutes apart count as one "sitting". "Reading" status means an unfinished book opened in the 30 days before the export's last session, or a finished one re-read for 30+ minutes since. `data/raw/book-overrides.json` (keyed by book id) corrects the list by hand:

- `title`, `authors`: replace what Kindle and the catalog lookups produced
- `coverUrl`: a verified cover URL, or `""` for no cover (the app shows a neutral placeholder, which beats a wrong cover)
- `sameAs`: this entry is a duplicate (another file or a store copy of the same book); its reading, finishes and highlights move to that id
- `exclude: true`: not a book; drop it and its reading
- `listed: false`: keep the reading in totals but don't list it as a book (Kindle's `title:untitled` catch-all is one)
- `finished: false`: ignore Kindle's finished mark. Kindle marks books finished manually (`_MANUAL` in `Kindle.UserUniqueTitlesCompleted.csv`) or automatically (`_AUTOMATIC`); automatic marks can fire when a file opens at its end
- `hidden: true`: leave the book out of the public build only

Without a manual title or author, `src/lib/bookNames.ts` cleans names automatically: "Last, First" becomes "First Last", credentials and "Unknown" are dropped, and store edition tags and "A Novel" subtitles are removed.

## Publishing The Dashboard

`bun run build:public` builds the app into `dist/` and replaces `dist/processed/` with a public copy of `reading.json` (`scripts/preparePublicBuild.ts`):

- only `reading.json` is shipped; the extracted event files and older aggregates never leave `data/processed/`
- Amazon ids (ASINs, personal document ids) become neutral ids like `b12`
- books with `"hidden": true` in `data/raw/book-overrides.json` are removed; their reading time still counts in totals, their finishes don't
- the build warns about titles that still look like file names or source tags, so they can be fixed or hidden

It is deployed to https://read.eone.work as the Cloudflare Worker `read-eone-work` (`wrangler.toml`). Ship it with `bun run deploy`, which runs `build:public` before `wrangler deploy`; never deploy a plain `bun run build`, because its `dist/processed/` is the full local data.

## Updating With A New Export

To refresh the project with a newer Amazon export:

1. Add the new archive to `data/exports/`. Keep the older exports there too.
2. Run `bun run ingest` (or `bun run snapshot`).

The extractor reads every `.zip` in `data/exports/`, ordered by export date (the newest file inside each archive, not the file's mtime), and merges them:

- event datasets (sessions, opens/closes, recommendations, searches, annotation actions, ...) are unioned; identical records count once, keeping the most repeats any single export has
- state datasets (`book_annotations` from Whispersync, `book_ownership`, the reader profile) come from the newest export only, so deletions and returns are respected
- book metadata is merged, with newer exports overriding older ones

If `data/exports/` is empty, the root `Amazon Kindle Data.zip` is used. Set `KINDLE_ARCHIVE_PATH` to extract one archive on its own.

Useful related commands:

- `bun run extract`
- `bun run metrics`
- `bun run sync`
- `bun run snapshot`

## Simple Snapshot Workflow

For a simple versioned-refresh workflow:

1. Put a new Amazon export zip into `data/exports/`.
2. Run `bun run snapshot`.

`bun run snapshot` will:

- name the snapshot after the newest `.zip` in `data/exports/`
- run extract + metrics, merging every export in `data/exports/`
- refresh the current `data/processed/` and `public/processed/` outputs
- copy the resulting processed JSON files into `data/snapshots/<snapshot-id>/processed/`
- write `data/snapshots/<snapshot-id>/snapshot.json` metadata listing the newest export and every merged export

## Important Caveat

Some UI concepts are exact export-backed facts, while others are heuristics derived from the exported behavior.

Examples of strong facts:

- reading sessions
- last read timestamps
- ownership
- completion events
- annotation counts
- search / recommendation telemetry

Examples that should be treated as heuristics unless explicitly backed by a dataset:

- "currently reading" and re-read status (based on recent sessions, as described above)
- sittings (merged session fragments)
- abandonment risk, resumption rate, inferred context labels like "deep work" or "before bed" (the current UI shows none of these)
- any per-book progress percentage if the export does not provide a trustworthy book-level progress field
