import { useMemo } from "react";
import { formatCount, formatHours, formatShortDate, joinAuthors } from "../app/format";
import type { Book, Library } from "../app/model";
import type { Route } from "../app/router";
import { finishesIn, type Period } from "../app/stats";
import { BookCover, EmptyState, PeriodPicker } from "../components/ui";

type ViewProps = { library: Library; route: Route; update: (patch: Partial<Route>) => void };

export function FinishedView({ library, route, update }: ViewProps) {
  const period: Period = route.year === null ? { kind: "all" } : { kind: "year", year: route.year };
  const finishes = useMemo(() => finishesIn(library, period), [library, route.year]);
  const finishYears = useMemo(
    () => [...new Set(finishesIn(library, { kind: "all" }).map((entry) => Number(entry.date.slice(0, 4))))],
    [library]
  );

  const groups = useMemo(() => {
    const byYear = new Map<number, Array<{ book: Book; date: string }>>();
    for (const entry of finishes) {
      const year = Number(entry.date.slice(0, 4));
      byYear.set(year, [...(byYear.get(year) ?? []), entry]);
    }
    return [...byYear].sort((left, right) => right[0] - left[0]);
  }, [finishes]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Finished</h1>
          <p className="page-subtitle">
            {formatCount(finishesIn(library, { kind: "all" }).length)} books I finished on Kindle, with the total time I spent in
            each.
          </p>
        </div>
      </div>

      <div className="filter-row">
        <PeriodPicker years={finishYears} year={route.year} onChange={(year) => update({ year })} />
      </div>

      {groups.length === 0 ? (
        <section className="card">
          <EmptyState>No book was marked finished in {route.year}.</EmptyState>
        </section>
      ) : (
        groups.map(([year, entries]) => {
          const hours = entries.reduce((sum, entry) => sum + entry.book.totalMs, 0);
          return (
            <section className="shelf" key={year} aria-labelledby={`shelf-${year}`}>
              <h2 className="shelf-title" id={`shelf-${year}`}>
                {year}
                <span className="shelf-meta">
                  {formatCount(entries.length)} {entries.length === 1 ? "book" : "books"} · {formatHours(hours)} in them
                </span>
              </h2>
              <ul className="shelf-grid">
                {entries.map(({ book, date }) => (
                  <li key={`${book.id}-${date}`}>
                    <button type="button" className="shelf-item" onClick={() => update({ book: book.id })}>
                      <BookCover book={book} size="medium" />
                      <span className="shelf-item-title">{book.title}</span>
                      <span className="shelf-item-meta">{joinAuthors(book.authors)}</span>
                      <span className="shelf-item-meta">
                        {formatShortDate(date)}
                        {book.totalMs > 0 ? ` · ${formatHours(book.totalMs)}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
