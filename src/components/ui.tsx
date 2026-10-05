import { useState, type ReactNode } from "react";
import { formatHours, joinAuthors } from "../app/format";
import type { Book, BookStatus } from "../app/model";

export function Card({
  title,
  subtitle,
  table,
  actions,
  children,
  className
}: {
  title: string;
  subtitle?: ReactNode;
  /** A table twin of the chart; adds a Chart / Table switch to the header. */
  table?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className={`card ${className ?? ""}`}>
      <header className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
        </div>
        <div className="card-actions">
          {actions}
          {table ? (
            <Segmented
              label={`${title} view`}
              size="small"
              value={showTable ? "table" : "chart"}
              options={[
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" }
              ]}
              onChange={(value) => setShowTable(value === "table")}
            />
          ) : null}
        </div>
      </header>
      {table && showTable ? <div className="table-scroll">{table}</div> : children}
    </section>
  );
}

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail ? <div className="stat-detail">{detail}</div> : null}
    </div>
  );
}

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  caption: string;
}) {
  return (
    <table className="data-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={column.numeric ? "numeric" : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} className={column.numeric ? "numeric" : undefined}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "default"
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  size?: "default" | "small";
}) {
  return (
    <div className={`segmented segmented-${size}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodPicker({
  years,
  year,
  onChange
}: {
  years: number[];
  year: number | null;
  onChange: (year: number | null) => void;
}) {
  return (
    <div className="period-picker">
      <Segmented
        label="Period"
        value={year === null ? "all" : String(year)}
        options={[{ value: "all", label: "All time" }, ...years.map((entry) => ({ value: String(entry), label: String(entry) }))]}
        onChange={(value) => onChange(value === "all" ? null : Number(value))}
      />
    </div>
  );
}

/** Ranked books with one single-color bar each; the bar is relative to the first (largest) entry. */
export function RankedBooks({
  items,
  onOpen
}: {
  items: Array<{ book: Book; ms: number }>;
  onOpen: (book: Book) => void;
}) {
  const max = items[0]?.ms ?? 0;
  return (
    <ol className="ranked">
      {items.map(({ book, ms }) => (
        <li key={book.id}>
          <button type="button" className="ranked-row" onClick={() => onOpen(book)}>
            <span className="ranked-text">
              <span className="ranked-title">{book.title}</span>
              <span className="ranked-meta">{joinAuthors(book.authors)}</span>
            </span>
            <span className="ranked-bar" aria-hidden="true">
              <span style={{ width: `${max > 0 ? Math.max(2, (ms / max) * 100) : 0}%` }} />
            </span>
            <span className="ranked-value">{formatHours(ms)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const STATUS_LABEL: Record<BookStatus, string> = {
  reading: "Reading",
  finished: "Finished",
  unfinished: "Unfinished"
};

export function StatusBadge({ status }: { status: BookStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function statusLabel(status: BookStatus): string {
  return STATUS_LABEL[status];
}

export function BookCover({ book, size = "medium" }: { book: Book; size?: "small" | "medium" | "large" }) {
  const [failed, setFailed] = useState(false);
  const initials = book.title
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.match(/\p{L}/u)![0].toUpperCase())
    .join("");

  if (!book.coverUrl || failed) {
    return (
      <div className={`cover cover-${size} cover-fallback`} aria-hidden="true">
        <span>{initials || "?"}</span>
      </div>
    );
  }

  return (
    <img
      className={`cover cover-${size}`}
      src={book.coverUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
