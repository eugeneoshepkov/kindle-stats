import { normalizeString } from "./normalizeKindle";

const genreAliases: Record<string, string> = {
  "Arts & Photography": "Arts & Photography",
  "Biografien & Erinnerungen": "Biographies & Memoirs",
  "Biographies & Memoirs": "Biographies & Memoirs",
  "Börse & Geld": "Business & Money",
  "Business & Karriere": "Business & Money",
  "Business & Money": "Business & Money",
  "Business, Finance & Law": "Business & Money",
  "Computer & Internet": "Computers & Technology",
  "Computers & Technology": "Computers & Technology",
  "Computing & Internet": "Computers & Technology",
  Esoterik: "Religion & Spirituality",
  Fantasy: "Science Fiction & Fantasy",
  "Fantasy & Science Fiction": "Science Fiction & Fantasy",
  Fachbücher: "Professional & Technical",
  Geschenkbücher: "Gift Books",
  History: "History",
  "Health, Fitness & Dieting": "Health, Fitness & Dieting",
  "Humor & Entertainment": "Humor & Entertainment",
  Kinderbücher: "Children's Books",
  "Krimis & Thriller": "Mystery, Thriller & Suspense",
  "Literatur & Fiktion": "Literature & Fiction",
  "Literature & Fiction": "Literature & Fiction",
  "Medical Books": "Medical Books",
  "Mystery, Thriller & Suspense": "Mystery, Thriller & Suspense",
  "Naturwissenschaften & Technik": "Science & Math",
  "Politics & Social Sciences": "Politics & Social Sciences",
  "Politik & Geschichte": "Politics & Social Sciences",
  Ratgeber: "Self-Help",
  "Reise & Abenteuer": "Travel & Adventure",
  Schule: "Education",
  "Schule & Lernen": "Education",
  "Science & Math": "Science & Math",
  "Self-Help": "Self-Help",
  Sozialwissenschaft: "Politics & Social Sciences",
  "Sport & Fitness": "Health, Fitness & Dieting",
  "Teen & Young Adult": "Teen & Young Adult"
};

export function normalizeGenreLabel(value: string | null | undefined): string | null {
  const genre = normalizeString(value);
  if (!genre) {
    return null;
  }

  return genreAliases[genre] ?? genre;
}
