import { isGoogleBooksPlaceholderVolumeCoverUrl } from "./googleBooksCover";

export function resolveCoverImageUrlForDisplay(url: string | null | undefined): string | null {
  if (!url?.trim()) {
    return null;
  }

  const trimmed = url.trim();
  if (isGoogleBooksPlaceholderVolumeCoverUrl(trimmed)) {
    return null;
  }

  return upgradeCoverImageUrl(trimmed) ?? trimmed;
}

function stripGoogleImageCruft(url: string): string {
  return url.replace(/^http:\/\//i, "https://").replace("&edge=curl", "");
}

function bumpFifeDimensions(url: URL): void {
  const fife = url.searchParams.get("fife");
  if (!fife) {
    return;
  }
  const match = /^w(\d+)-h(\d+)$/i.exec(fife);
  if (!match) {
    return;
  }
  const w = Math.max(Number(match[1]), 800);
  const h = Math.max(Number(match[2]), 1200);
  url.searchParams.set("fife", `w${w}-h${h}`);
}

export function upgradeCoverImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) {
    return null;
  }

  let u = stripGoogleImageCruft(url.trim());

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return u.replace(/zoom=\d+/gi, "zoom=0");
  }

  const host = parsed.hostname.toLowerCase();
  const isGoogleCover =
    host.includes("googleusercontent.com") ||
    host.endsWith("gstatic.com") ||
    (host.endsWith("google.com") && parsed.pathname.includes("/books/"));

  if (!isGoogleCover) {
    return u;
  }

  if (parsed.searchParams.has("zoom")) {
    parsed.searchParams.set("zoom", "0");
  }

  parsed.searchParams.delete("edge");
  bumpFifeDimensions(parsed);

  return parsed.toString();
}

export function pickBestGoogleBooksImageLink(imageLinks: Record<string, string> | undefined): string | null {
  if (!imageLinks) {
    return null;
  }

  const order = ["extraLarge", "large", "medium", "small", "thumbnail", "smallThumbnail"] as const;
  for (const key of order) {
    const raw = imageLinks[key];
    if (raw) {
      const cleaned = stripGoogleImageCruft(raw);
      return upgradeCoverImageUrl(cleaned) ?? cleaned;
    }
  }

  return null;
}
