import type { BookRecommendation, EnrichedBook } from "./types";

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function topGenres(books: EnrichedBook[]): Set<string> {
  const counts = new Map<string, number>();

  for (const book of books) {
    for (const genre of book.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + book.totalReadingMs + book.completionCount * 120_000);
    }
  }

  return new Set(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([genre]) => genre)
  );
}

function topAuthors(books: EnrichedBook[]): Set<string> {
  const counts = new Map<string, number>();

  for (const book of books) {
    for (const author of book.authors) {
      counts.set(author, (counts.get(author) ?? 0) + book.totalReadingMs + book.completionCount * 200_000);
    }
  }

  return new Set(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([author]) => author)
  );
}

export function recommendBooks(books: EnrichedBook[]): BookRecommendation[] {
  const completed = books.filter((book) => book.completionCount > 0);
  const engaged = books.filter((book) => book.totalReadingMs > 0 || book.annotationCount > 0);
  const favoriteGenres = topGenres(completed.length > 0 ? completed : engaged);
  const favoriteAuthors = topAuthors(completed.length > 0 ? completed : engaged);
  const finishedSeries = new Set(
    completed.map((book) => book.seriesTitle).filter((seriesTitle): seriesTitle is string => Boolean(seriesTitle))
  );

  return books
    .filter((book) => book.completionCount === 0)
    .filter((book) => book.isOwned || book.recommendationClickCount > 0 || book.recommendationViewCount > 0)
    .map((book) => {
      let score = 0;
      const reasons: string[] = [];

      const matchingGenres = book.genres.filter((genre) => favoriteGenres.has(genre));
      if (matchingGenres.length > 0) {
        score += matchingGenres.length * 3;
        reasons.push(`Matches your strongest genres: ${matchingGenres.slice(0, 2).join(", ")}`);
      }

      const matchingAuthors = book.authors.filter((author) => favoriteAuthors.has(author));
      if (matchingAuthors.length > 0) {
        score += matchingAuthors.length * 4;
        reasons.push(`By an author you keep returning to`);
      }

      if (book.seriesTitle && finishedSeries.has(book.seriesTitle)) {
        score += 5;
        reasons.push("Next step in a series you already finished");
      }

      if (book.recommendationClickCount > 0) {
        score += book.recommendationClickCount * 2.5;
        reasons.push("You clicked a similar Kindle recommendation");
      } else if (book.recommendationViewCount > 0) {
        score += Math.min(book.recommendationViewCount, 3) * 0.75;
        reasons.push("Kindle surfaced it in your recommendation feed");
      }

      if (book.annotationCount > 0) {
        score += Math.min(book.annotationCount, 4) * 0.8;
      }

      if (!book.isPersonalDocument) {
        score += 1;
      } else {
        score -= 1.5;
      }

      if (book.totalReadingMs > 0) {
        score -= 2;
      }

      return {
        bookId: book.id,
        title: book.title,
        author: book.authors[0] ?? "Unknown author",
        genres: book.genres,
        seriesTitle: book.seriesTitle,
        score: roundScore(score),
        reasons: reasons.slice(0, 3),
        readingHours: Math.round((book.totalReadingMs / 3_600_000) * 10) / 10
      };
    })
    .filter((book) => book.score > 0)
    .sort((left, right) => right.score - left.score || right.readingHours - left.readingHours)
    .slice(0, 12);
}
