import { useMemo } from "react";
import {
  formatCount,
  formatDate,
  formatDuration,
  formatHours,
  formatMonth,
  formatMonthYear,
  formatPercent,
  formatShortDate,
  joinAuthors
} from "../app/format";
import { ACTIVE_WINDOW_DAYS, dayAfter, type Book, type Library } from "../app/model";
import type { Route } from "../app/router";
import {
  dailyTotals,
  entriesIn,
  finishesIn,
  monthlySeries,
  periodBounds,
  summarize,
  topBooks,
  yearSummaries,
  type Period,
  type Streak
} from "../app/stats";
import { BarChart } from "../components/BarChart";
import { CalendarHeatmap } from "../components/CalendarHeatmap";
import { BookCover, Card, DataTable, EmptyState, PeriodPicker, RankedBooks, StatTile } from "../components/ui";

type ViewProps = { library: Library; route: Route; update: (patch: Partial<Route>) => void };

function streakRange(streak: Streak): string {
  if (streak.length === 1) {
    return formatDate(streak.start);
  }
  const sameYear = streak.start.slice(0, 4) === streak.end.slice(0, 4);
  return `${sameYear ? formatShortDate(streak.start) : formatDate(streak.start)} – ${formatDate(streak.end)}`;
}

function CurrentlyReading({ library, onOpen }: { library: Library; onOpen: (book: Book) => void }) {
  const since = dayAfter(library.lastDay, -(ACTIVE_WINDOW_DAYS - 1));
  const recentMs = new Map<number, number>();
  for (const entry of library.entries) {
    if (entry.day >= since) {
      recentMs.set(entry.book, (recentMs.get(entry.book) ?? 0) + entry.ms);
    }
  }
  const books = library.books
    .filter((book) => book.status === "reading")
    .sort((left, right) => (right.lastRead ?? "").localeCompare(left.lastRead ?? ""));

  return (
    <Card title="Currently reading" subtitle={`Books I opened in the ${ACTIVE_WINDOW_DAYS} days up to ${formatDate(library.lastDay)}`}>
      {books.length === 0 ? (
        <EmptyState>I didn't open an unfinished book in that window.</EmptyState>
      ) : (
        <ul className="now-reading">
          {books.map((book) => (
            <li key={book.id}>
              <button type="button" className="now-reading-item" onClick={() => onOpen(book)}>
                <BookCover book={book} size="medium" />
                <span className="now-reading-text">
                  <span className="now-reading-title">{book.title}</span>
                  <span className="now-reading-meta">{joinAuthors(book.authors)}</span>
                  <span className="now-reading-meta">
                    {formatHours(recentMs.get(book.index) ?? 0)} in {ACTIVE_WINDOW_DAYS} days · last read{" "}
                    {formatShortDate(book.lastRead!)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OverviewView({ library, route, update }: ViewProps) {
  const period: Period = route.year === null ? { kind: "all" } : { kind: "year", year: route.year };
  const periodName = period.kind === "all" ? "all time" : String(period.year);
  const openBook = (book: Book) => update({ book: book.id });

  const entries = useMemo(() => entriesIn(library, period), [library, route.year]);
  const summary = useMemo(() => summarize(library, period), [library, route.year]);
  const monthly = useMemo(() => monthlySeries(library, period), [library, route.year]);
  const daily = useMemo(() => dailyTotals(entries), [entries]);
  const top = useMemo(() => topBooks(library, entries, 8), [library, entries]);
  const finishes = useMemo(() => finishesIn(library, period), [library, route.year]);
  const years = useMemo(() => yearSummaries(library), [library]);
  const bounds = periodBounds(library, { kind: "all" });

  const calendarYears =
    period.kind === "all" ? library.years.filter((year) => years.find((entry) => entry.year === year)!.readingDays > 0) : [period.year];
  const streak = summary.currentStreak ?? summary.longestStreak;
  const hasCompare = monthly.some((point) => point.compare !== undefined);

  const monthlyTable = (
    <DataTable
      caption="Reading time by month"
      rows={[...monthly].reverse()}
      rowKey={(point) => point.key}
      columns={[
        { key: "month", header: "Month", cell: (point) => formatMonthYear(point.key) },
        { key: "time", header: "Time", numeric: true, cell: (point) => formatDuration(point.value) },
        ...(hasCompare
          ? [
              {
                key: "compare",
                header: `${(period as { year: number }).year - 1}`,
                numeric: true,
                cell: (point: (typeof monthly)[number]) => formatDuration(point.compare ?? 0)
              }
            ]
          : [])
      ]}
    />
  );

  const daysByMonth = useMemo(() => {
    const months = new Map<string, { days: number; ms: number }>();
    for (const [day, ms] of daily) {
      const entry = months.get(day.slice(0, 7)) ?? { days: 0, ms: 0 };
      entry.days += 1;
      entry.ms += ms;
      months.set(day.slice(0, 7), entry);
    }
    return [...months].sort((left, right) => right[0].localeCompare(left[0]));
  }, [daily]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p className="page-subtitle">
            My reading on Kindle from {formatDate(library.firstDay)} to {formatDate(library.lastDay)}
          </p>
        </div>
      </div>

      <CurrentlyReading library={library} onOpen={openBook} />

      <div className="filter-row">
        <PeriodPicker years={library.years} year={route.year} onChange={(year) => update({ year })} />
      </div>

      <div className="stats">
        <StatTile
          label="Time read"
          value={formatHours(summary.totalMs)}
          detail={summary.readingDays > 0 ? `${formatDuration(summary.avgPerReadingDayMs)} per reading day` : undefined}
        />
        <StatTile
          label="Reading days"
          value={formatCount(summary.readingDays)}
          detail={
            summary.periodDays > 0
              ? `${formatPercent(summary.readingDays / summary.periodDays)} of ${formatCount(summary.periodDays)} days`
              : undefined
          }
        />
        <StatTile label="Books finished" value={formatCount(summary.finished)} detail="Marked finished on Kindle" />
        <StatTile
          label={summary.currentStreak ? "Current streak" : "Longest streak"}
          value={streak ? `${formatCount(streak.length)} ${streak.length === 1 ? "day" : "days"}` : "—"}
          detail={
            summary.currentStreak && summary.longestStreak
              ? `Longest: ${formatCount(summary.longestStreak.length)} days, ${streakRange(summary.longestStreak)}`
              : streak
                ? streakRange(streak)
                : undefined
          }
        />
      </div>

      <Card
        title="Reading time by month"
        subtitle={
          period.kind === "year"
            ? hasCompare
              ? `${period.year} compared with ${period.year - 1}`
              : String(period.year)
            : "Select a month to see its year"
        }
        table={monthlyTable}
      >
        <BarChart
          points={monthly}
          ariaLabel={`Reading time by month, ${periodName}`}
          seriesName={period.kind === "year" ? String(period.year) : "Reading time"}
          compareName={period.kind === "year" ? String(period.year - 1) : undefined}
          label={formatMonthYear}
          formatValue={formatDuration}
          tickLabel={(key, index) =>
            period.kind === "year" ? formatMonth(key) : key.endsWith("-01") || index === 0 ? key.slice(0, 4) : null
          }
          onSelect={period.kind === "all" ? (key) => update({ year: Number(key.slice(0, 4)) }) : undefined}
        />
      </Card>

      <Card
        title="Reading calendar"
        subtitle={`Each square is a day${period.kind === "all" ? "; most recent year first" : ""}`}
        table={
          <DataTable
            caption="Reading days by month"
            rows={daysByMonth}
            rowKey={([month]) => month}
            columns={[
              { key: "month", header: "Month", cell: ([month]) => formatMonthYear(month) },
              { key: "days", header: "Reading days", numeric: true, cell: ([, entry]) => entry.days },
              { key: "time", header: "Time", numeric: true, cell: ([, entry]) => formatDuration(entry.ms) },
              { key: "avg", header: "Per reading day", numeric: true, cell: ([, entry]) => formatDuration(entry.ms / entry.days) }
            ]}
          />
        }
      >
        {bounds ? <CalendarHeatmap years={calendarYears} daily={daily} start={bounds.start} end={bounds.end} /> : null}
      </Card>

      <div className="grid-2">
        <Card title="Most read" subtitle={`By reading time, ${periodName}`}>
          {top.length > 0 ? <RankedBooks items={top} onOpen={openBook} /> : <EmptyState>No reading in this period.</EmptyState>}
        </Card>

        {period.kind === "year" ? (
          <Card
            title={`Finished in ${period.year}`}
            subtitle={`${formatCount(finishes.length)} ${finishes.length === 1 ? "book" : "books"}`}
            actions={
              finishes.length > 0 ? (
                <a className="text-link" href={`#/finished?year=${period.year}`}>
                  View all
                </a>
              ) : null
            }
          >
            {finishes.length > 0 ? (
              <ul className="finish-list">
                {finishes.slice(0, 8).map(({ book, date }) => (
                  <li key={`${book.id}-${date}`}>
                    <button type="button" className="finish-row" onClick={() => openBook(book)}>
                      <BookCover book={book} size="small" />
                      <span className="finish-text">
                        <span className="finish-title">{book.title}</span>
                        <span className="finish-meta">{joinAuthors(book.authors)}</span>
                      </span>
                      <span className="finish-date">{formatShortDate(date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No book was marked finished in {period.year}.</EmptyState>
            )}
          </Card>
        ) : (
          <Card title="Year by year" subtitle="Select a year to focus on it">
            <div className="table-scroll">
              <table className="data-table is-interactive">
                <caption className="visually-hidden">Reading summary per year</caption>
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col" className="numeric">
                      Time
                    </th>
                    <th scope="col" className="numeric">
                      Days
                    </th>
                    <th scope="col" className="numeric">
                      Per day
                    </th>
                    <th scope="col" className="numeric">
                      Finished
                    </th>
                    <th scope="col" className="numeric">
                      Best streak
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((entry) => (
                    <tr key={entry.year}>
                      <td>
                        <a className="text-link" href={`#/overview?year=${entry.year}`}>
                          {entry.year}
                        </a>
                      </td>
                      <td className="numeric">{formatHours(entry.totalMs)}</td>
                      <td className="numeric">{formatCount(entry.readingDays)}</td>
                      <td className="numeric">{entry.readingDays > 0 ? formatDuration(entry.avgPerReadingDayMs) : "—"}</td>
                      <td className="numeric">{formatCount(entry.finished)}</td>
                      <td className="numeric">{entry.longestStreak ? `${entry.longestStreak.length} d` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
