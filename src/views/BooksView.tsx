import { useMemo, useState } from "react";
import { formatCount, formatDate, formatHours, formatShortDate, joinAuthors } from "../app/format";
import type { Book, BookStatus, Library } from "../app/model";
import type { Route } from "../app/router";
import { BookCover, Segmented, StatusBadge, statusLabel } from "../components/ui";

type ViewProps = {
  library: Library;
  route: Route;
  update: (patch: Partial<Route>, options?: { replace?: boolean }) => void;
};

type SortKey = "title" | "time" | "days" | "lastRead" | "finished";
type StatusFilter = "all" | BookStatus;

const SORTS: Record<SortKey, { label: string; compare: (left: Book, right: Book) => number; defaultDescending: boolean }> = {
  title: { label: "Book", compare: (left, right) => left.title.localeCompare(right.title), defaultDescending: false },
  time: { label: "Time read", compare: (left, right) => left.totalMs - right.totalMs, defaultDescending: true },
  days: { label: "Days", compare: (left, right) => left.readingDays - right.readingDays, defaultDescending: true },
  lastRead: {
    label: "Last read",
    compare: (left, right) => (left.lastRead ?? "").localeCompare(right.lastRead ?? ""),
    defaultDescending: true
  },
  finished: {
    label: "Finished",
    compare: (left, right) => (left.lastFinished ?? "").localeCompare(right.lastFinished ?? ""),
    defaultDescending: true
  }
};

function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function BooksView({ library, route, update }: ViewProps) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "lastRead", descending: true });

  const searched = useMemo(() => {
    const terms = normalizeForSearch(route.query).split(/\s+/).filter(Boolean);
    return library.books.filter((book) => {
      const haystack = normalizeForSearch(`${book.title} ${book.authors.join(" ")} ${book.seriesTitle ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [library, route.query]);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { all: searched.length, reading: 0, finished: 0, unfinished: 0 };
    for (const book of searched) {
      result[book.status] += 1;
    }
    return result;
  }, [searched]);

  const rows = useMemo(() => {
    const filtered = status === "all" ? searched : searched.filter((book) => book.status === status);
    const { compare } = SORTS[sort.key];
    return [...filtered].sort((left, right) => (sort.descending ? -compare(left, right) : compare(left, right)));
  }, [searched, status, sort]);

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: SORTS[key].defaultDescending }
    );

  const header = (key: SortKey, className?: string) => (
    <th
      scope="col"
      className={className}
      aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : undefined}
    >
      <button type="button" className="sort-button" onClick={() => sortBy(key)}>
        {SORTS[key].label}
        <span className="sort-indicator" aria-hidden="true">
          {sort.key === key ? (sort.descending ? "↓" : "↑") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Books</h1>
          <p className="page-subtitle">
            {formatCount(library.books.length)} books I have read on Kindle, finished or not
          </p>
        </div>
      </div>

      <div className="filter-row books-filters">
        <label className="search">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">Search books</span>
          <input
            type="search"
            placeholder="Search title or author"
            value={route.query}
            onChange={(event) => update({ query: event.target.value }, { replace: true })}
          />
        </label>
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={(["all", "reading", "finished", "unfinished"] as const).map((value) => ({
            value,
            label: (
              <>
                {{ all: "All", reading: "Reading", finished: "Finished", unfinished: "Unfinished" }[value]}
                <span className="count">{counts[value]}</span>
              </>
            )
          }))}
        />
      </div>

      <section className="card card-flush">
        {rows.length === 0 ? (
          <p className="empty">No books match these filters.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table books-table is-interactive">
              <caption className="visually-hidden">Books, sorted by {SORTS[sort.key].label.toLowerCase()}</caption>
              <thead>
                <tr>
                  {header("title")}
                  <th scope="col" className="col-status">
                    Status
                  </th>
                  {header("time", "numeric col-time")}
                  {header("days", "numeric col-days")}
                  {header("lastRead", "numeric col-last")}
                  {header("finished", "numeric col-finished")}
                </tr>
              </thead>
              <tbody>
                {rows.map((book) => (
                  <tr key={book.id} onClick={() => update({ book: book.id })}>
                    <td>
                      <button
                        type="button"
                        className="book-cell"
                        onClick={(event) => {
                          event.stopPropagation();
                          update({ book: book.id });
                        }}
                      >
                        <BookCover book={book} size="small" />
                        <span className="book-cell-text">
                          <span className="book-cell-title">{book.title}</span>
                          <span className="book-cell-meta">{joinAuthors(book.authors)}</span>
                          <span className="book-cell-mobile">
                            {[
                              statusLabel(book.status),
                              book.totalMs > 0 ? formatHours(book.totalMs) : null,
                              book.lastRead ? `last read ${formatShortDate(book.lastRead)}` : null
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="col-status">
                      <StatusBadge status={book.status} />
                    </td>
                    <td className="numeric col-time">{book.totalMs > 0 ? formatHours(book.totalMs) : "—"}</td>
                    <td className="numeric col-days">{book.readingDays || "—"}</td>
                    <td className="numeric col-last">{book.lastRead ? formatDate(book.lastRead) : "—"}</td>
                    <td className="numeric col-finished">{book.lastFinished ? formatDate(book.lastFinished) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
