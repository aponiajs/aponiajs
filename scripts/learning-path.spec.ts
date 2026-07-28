import { readdir } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

const learningPath = "docs/learn";
const chapterPattern = /^(\d{2})-[a-z0-9-]+\.md$/;

const entries = await readdir(learningPath);
const chapters = entries.filter((entry) => chapterPattern.test(entry)).sort();
const index = await Bun.file(`${learningPath}/README.md`).text();

describe("learning path", () => {
  test("numbers its chapters contiguously from 01", () => {
    const numbers = chapters.map((chapter) => Number(chapterPattern.exec(chapter)?.[1]));

    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, position) => position + 1));
  });

  test("lists every chapter in its index", () => {
    for (const chapter of chapters) {
      expect(index).toContain(`(./${chapter})`);
    }
  });

  test("contains no chapter the index invents", () => {
    for (const link of index.matchAll(/\(\.\/(\d{2}-[a-z0-9-]+\.md)\)/g)) {
      expect(chapters).toContain(link[1]);
    }
  });

  test("opens each chapter with the case it applies to", async () => {
    for (const chapter of chapters) {
      const content = await Bun.file(`${learningPath}/${chapter}`).text();

      expect(content).toStartWith(`# ${chapterPattern.exec(chapter)?.[1]} · `);
      expect(content).toContain("**Use when:**");
    }
  });

  test("chains every chapter but the last to its successor", async () => {
    for (const [position, chapter] of chapters.entries()) {
      const content = await Bun.file(`${learningPath}/${chapter}`).text();
      const successor = chapters[position + 1];

      if (successor === undefined) {
        expect(content).toContain("Deep dive:");
        continue;
      }

      expect(content).toContain(`(./${successor})`);
    }
  });
});
