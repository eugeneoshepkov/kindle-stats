# Kindle Stats

A local-first Kindle reading dashboard built from Amazon Kindle export data.

Run `bun run dev` and open http://localhost:5173. Views:

- **Overview**: time read, reading days, books finished and streaks for all time or any year; reading time by month (compared with the previous year); a daily reading calendar; currently reading; most read books; year by year
- **Books**: every book opened or finished on Kindle, searchable and sortable, with a detail panel per book
- **Habits**: when you read (weekday x hour), by weekday and time of day, and how long your sittings last
- **Finished**: books marked finished, grouped by year

## Data provenance

This project uses data from Amazon's Kindle privacy export / "Request your data" flow.

Main raw inputs:

- `Amazon Kindle Data.zip`
- `Amazon Data Descriptions.csv`

For a fuller explanation of where the data comes from, which archive members are parsed, and which metrics are factual vs heuristic, see:

- `AGENTS.md`

## Publishing

`bun run build:public` writes a deployable `dist/` holding only aggregated reading data: no session timestamps, no Amazon ids, nothing from the raw export. To leave a book out, add `"hidden": true` to its entry in `data/raw/book-overrides.json`. Days and hours use `READING_TIME_ZONE` (default: this machine's zone), so every visitor sees the same numbers.

Live at https://read.eone.work. `bun run deploy` runs the public build and ships it to Cloudflare (`wrangler.toml`); never deploy a plain `bun run build`.

## Commands

- `bun run extract`
- `bun run metrics`
- `bun run ingest`
- `bun run snapshot`
- `bun run sync`
- `bun run dev`
- `bun test`

## Refresh with a new export

1. Add the latest archive from Amazon to `data/exports/`, keeping older exports there: newer exports drop older device history, so all of them are merged.
2. Run `bun run ingest`.

## Versioned snapshot workflow

If you want a simpler "drop export and version it" flow:

1. Put the new Amazon Kindle zip into `data/exports/`.
2. Run `bun run snapshot`.

That command will:

- merge every zip in `data/exports/` and name the snapshot after the newest
- refresh the current processed app data
- create a dated snapshot under `data/snapshots/<snapshot-id>/processed/`
- write `snapshot.json` metadata alongside it

Processed outputs are written to:

- `data/processed/`
- `public/processed/`
