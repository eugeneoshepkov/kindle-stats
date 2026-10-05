import { useCallback, useEffect, useState } from "react";
import { formatDate } from "./app/format";
import { loadLibrary, type Library } from "./app/model";
import { routeHref, useRoute, VIEWS, type View } from "./app/router";
import { BookDrawer } from "./components/BookDrawer";
import { BooksView } from "./views/BooksView";
import { FinishedView } from "./views/FinishedView";
import { HabitsView } from "./views/HabitsView";
import { OverviewView } from "./views/OverviewView";

const VIEW_LABEL: Record<View, string> = {
  overview: "Overview",
  books: "Books",
  habits: "Habits",
  finished: "Finished"
};

type Theme = "light" | "dark";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function useTheme(): [Theme, () => void] {
  const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? (systemDark() ? "dark" : "light"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () =>
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("theme", next);
      } catch {
        // Storage can be unavailable (private mode); the toggle still works for this visit.
      }
      return next;
    });

  return [theme, toggle];
}

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, update] = useRoute();
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    loadLibrary().then(setLibrary, (loadError: Error) => setError(loadError.message));
  }, []);

  useEffect(() => {
    document.title = `${VIEW_LABEL[route.view]} · Kindle Stats`;
  }, [route.view]);

  const closeBook = useCallback(() => update({ book: null }), [update]);
  const book = library && route.book ? (library.booksById.get(route.book) ?? null) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/overview">
            Kindle Stats
          </a>
          <nav className="nav" aria-label="Sections">
            {VIEWS.map((view) => (
              <a
                key={view}
                className="nav-link"
                href={routeHref({ ...route, view, book: null, query: view === "books" ? route.query : "" })}
                aria-current={route.view === view ? "page" : undefined}
              >
                {VIEW_LABEL[view]}
              </a>
            ))}
          </nav>
          <div className="topbar-end">
            {library ? <span className="data-through">Data through {formatDate(library.lastDay)}</span> : null}
            <a className="topbar-link" href="https://eone.work">
              eone.work
            </a>
            <button
              type="button"
              className="icon-button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {error ? (
          <div className="page">
            <section className="card">
              <h1>Couldn’t load reading data</h1>
              <p className="muted">{error}</p>
            </section>
          </div>
        ) : !library ? (
          <div className="page">
            <p className="muted">Loading reading data…</p>
          </div>
        ) : route.view === "books" ? (
          <BooksView library={library} route={route} update={update} />
        ) : route.view === "habits" ? (
          <HabitsView library={library} route={route} update={update} />
        ) : route.view === "finished" ? (
          <FinishedView library={library} route={route} update={update} />
        ) : (
          <OverviewView library={library} route={route} update={update} />
        )}
      </main>

      {library && book ? <BookDrawer library={library} book={book} onClose={closeBook} /> : null}
    </div>
  );
}
