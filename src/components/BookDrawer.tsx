import { useEffect, useMemo, useRef } from "react";
import {
  formatDate,
  formatDuration,
  formatHours,
  formatMonth,
  formatMonthYear,
  formatShortDate,
  joinAuthors
} from "../app/format";
import type { Book, Library } from "../app/model";
import { bookActivity, type ActivityUnit } from "../app/stats";
import { BarChart } from "./BarChart";
import { BookCover, StatusBadge } from "./ui";

const UNIT_TITLE: Record<ActivityUnit, string> = {
  day: "Reading time per day",
  week: "Reading time per week",
  month: "Reading time per month"
};

export function BookDrawer({ library, book, onClose }: { library: Library; book: Book; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const entries = useMemo(() => library.entries.filter((entry) => entry.book === book.index), [library, book]);
  const activity = useMemo(() => bookActivity(entries), [entries]);

  useEffect(() => {
    headingRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, onClose]);

  const pointLabel = (key: string) =>
    activity.unit === "month" ? formatMonthYear(key) : activity.unit === "week" ? `Week of ${formatDate(key)}` : formatDate(key);
  const tickEvery = Math.max(1, Math.ceil(activity.points.length / 6));

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-top">
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close book details">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="drawer-hero">
          <BookCover book={book} size="large" />
          <div className="drawer-heading">
            <StatusBadge status={book.status} />
            <h2 id="drawer-title" ref={headingRef} tabIndex={-1}>
              {book.title}
            </h2>
            <p className="drawer-authors">{joinAuthors(book.authors)}</p>
            {book.seriesTitle ? <p className="drawer-kind">{book.seriesTitle}</p> : null}
          </div>
        </div>

        <dl className="facts">
          <div>
            <dt>Time read</dt>
            <dd>{book.totalMs > 0 ? formatDuration(book.totalMs) : "—"}</dd>
          </div>
          <div>
            <dt>Reading days</dt>
            <dd>{book.readingDays}</dd>
          </div>
          <div>
            <dt>Sittings</dt>
            <dd>{book.sittings}</dd>
          </div>
          <div>
            <dt>Per reading day</dt>
            <dd>{book.readingDays > 0 ? formatDuration(book.totalMs / book.readingDays) : "—"}</dd>
          </div>
          <div>
            <dt>First read</dt>
            <dd>{book.firstRead ? formatDate(book.firstRead) : "—"}</dd>
          </div>
          <div>
            <dt>Last read</dt>
            <dd>{book.lastRead ? formatDate(book.lastRead) : "—"}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{book.finishedOn.length > 0 ? book.finishedOn.map((date) => formatDate(date)).join(", ") : "Not marked finished"}</dd>
          </div>
          <div>
            <dt>Highlights</dt>
            <dd>{book.highlights}</dd>
          </div>
        </dl>

        {activity.points.length > 1 ? (
          <section className="drawer-section">
            <h3>{UNIT_TITLE[activity.unit]}</h3>
            <BarChart
              points={activity.points}
              ariaLabel={`${UNIT_TITLE[activity.unit]} for ${book.title}`}
              seriesName="Reading time"
              label={pointLabel}
              formatValue={formatDuration}
              height={160}
              tickLabel={(key, index) =>
                index % tickEvery === 0
                  ? activity.unit === "month"
                    ? key.endsWith("-01") || index === 0
                      ? formatMonthYear(key)
                      : formatMonth(key)
                    : formatShortDate(key)
                  : null
              }
            />
          </section>
        ) : activity.points.length === 1 ? (
          <p className="muted drawer-section">
            All {formatHours(book.totalMs)} of reading happened on {formatDate(entries[0].day)}.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
