import { useCallback, useEffect, useState } from "react";

export const VIEWS = ["overview", "books", "habits", "finished"] as const;
export type View = (typeof VIEWS)[number];

export type Route = {
  view: View;
  /** Selected year, or null for all time. */
  year: number | null;
  /** Book shown in the detail panel. */
  book: string | null;
  /** Books view search text. */
  query: string;
};

function parseHash(hash: string): Route {
  const [path, search = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(search);
  const year = Number(params.get("year"));

  return {
    view: (VIEWS as readonly string[]).includes(path) ? (path as View) : "overview",
    year: Number.isInteger(year) && year > 0 ? year : null,
    book: params.get("book"),
    query: params.get("q") ?? ""
  };
}

export function routeHref(route: Route): string {
  const params = new URLSearchParams();
  if (route.year !== null) {
    params.set("year", String(route.year));
  }
  if (route.query) {
    params.set("q", route.query);
  }
  if (route.book) {
    params.set("book", route.book);
  }
  const search = params.toString();
  return `#/${route.view}${search ? `?${search}` : ""}`;
}

/** App state lives in the URL hash, so every view, filter and open book can be bookmarked and survives reloads. */
export function useRoute(): [Route, (patch: Partial<Route>, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const update = useCallback((patch: Partial<Route>, options?: { replace?: boolean }) => {
    const next = routeHref({ ...parseHash(window.location.hash), ...patch });
    if (options?.replace) {
      window.history.replaceState(null, "", next);
      setRoute(parseHash(next));
    } else {
      window.location.hash = next;
    }
  }, []);

  return [route, update];
}
