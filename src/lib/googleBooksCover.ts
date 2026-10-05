export function isGoogleBooksPlaceholderVolumeCoverUrl(url: string | null | undefined): boolean {
  if (!url || !url.includes("books.google")) {
    return false;
  }

  try {
    const id = new URL(url).searchParams.get("id");
    if (!id) {
      return false;
    }
    return id.length >= 5 && id.toUpperCase().endsWith("ACAAJ");
  } catch {
    return false;
  }
}
