import { describe, expect, test } from "bun:test";
import { cleanDisplayTitle, normalizeAuthors } from "../src/lib/bookNames";

describe("normalizeAuthors", () => {
  test("turns catalog 'Last, First' into reading order", () => {
    expect(normalizeAuthors(["Hof, Wim"])).toEqual(["Wim Hof"]);
    expect(normalizeAuthors(["Watkins, Michael D."])).toEqual(["Michael D. Watkins"]);
    expect(normalizeAuthors(["Сафон, Карлос Руис"])).toEqual(["Карлос Руис Сафон"]);
  });

  test("drops credentials, placeholders and duplicate spellings", () => {
    expect(normalizeAuthors(["Grant Ph.D., Adam M."])).toEqual(["Adam M. Grant"]);
    expect(normalizeAuthors(["Peter Attia, MD"])).toEqual(["Peter Attia"]);
    expect(normalizeAuthors(["Unknown"])).toEqual([]);
    expect(normalizeAuthors(["Кукушкин, Николай", "Кукушкин,Николай"])).toEqual(["Николай Кукушкин"]);
    expect(normalizeAuthors(["Таня  Щукина"])).toEqual(["Таня Щукина"]);
  });

  test("splits two full names stored as one entry", () => {
    expect(normalizeAuthors(["Роман Баданин, Михаил Рубин"])).toEqual(["Роман Баданин", "Михаил Рубин"]);
  });
});

describe("cleanDisplayTitle", () => {
  test("removes store edition tags and 'A Novel' subtitles", () => {
    expect(cleanDisplayTitle("Death's End (US)")).toBe("Death's End");
    expect(cleanDisplayTitle("Short Stories in German for Beginners (Readers) (German Edition)")).toBe(
      "Short Stories in German for Beginners"
    );
    expect(cleanDisplayTitle("Project Hail Mary : a novel")).toBe("Project Hail Mary");
  });

  test("fixes catalog colon spacing and strips a trailing author", () => {
    expect(cleanDisplayTitle("Walking Disaster : My Life Through Heaven and Hell")).toBe("Walking Disaster: My Life Through Heaven and Hell");
    expect(cleanDisplayTitle("Alive: The Story of the Andes Survivors by Piers Paul Read", ["Piers Paul Read"])).toBe(
      "Alive: The Story of the Andes Survivors"
    );
  });

  test("matches authors even when the file name uses decomposed letters", () => {
    expect(cleanDisplayTitle("Новая версия - Андрей Дороничев".normalize("NFD"), ["Андрей Дороничев"])).toBe("Новая версия");
  });
});
