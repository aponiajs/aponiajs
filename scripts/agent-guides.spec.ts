import { readlink } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

const guideDirectories = [
  "docs",
  "examples",
  "scripts",
  "packages/aponiajs",
  "packages/cli",
  "packages/common",
  "packages/core",
  "packages/create-aponia",
  "packages/platform-elysia",
] as const;

const rootGuide = await Bun.file("AGENTS.md").text();

describe("agent guides", () => {
  test("every package and supporting directory carries one", async () => {
    for (const directory of guideDirectories) {
      expect(await Bun.file(`${directory}/AGENTS.md`).exists()).toBe(true);
    }
  });

  test("the repository guide indexes every one of them", () => {
    for (const directory of guideDirectories) {
      expect(rootGuide).toContain(`(${directory}/AGENTS.md)`);
    }
  });

  test("each guide points back at the repository guide", async () => {
    for (const directory of guideDirectories) {
      const guide = await Bun.file(`${directory}/AGENTS.md`).text();
      const parent = directory.includes("/") ? "../../AGENTS.md" : "../AGENTS.md";

      expect(guide).toContain(parent);
    }
  });

  test("CLAUDE.md and GEMINI.md stay symlinks to the real file", async () => {
    for (const directory of ["." as const, ...guideDirectories]) {
      for (const alias of ["CLAUDE.md", "GEMINI.md"]) {
        expect(await readlink(`${directory}/${alias}`)).toBe("AGENTS.md");
      }
    }
  });
});
