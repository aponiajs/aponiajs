import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { libraryCatalog, searchLibraries } from "../packages/cli/src/library/catalog.ts";

describe("library catalog", () => {
  test("names each official entry after a published workspace package", async () => {
    const names = new Set<string>();
    for (const entry of await readdir("packages", { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = join("packages", entry.name, "package.json");
      const file = Bun.file(path);
      if (!(await file.exists())) {
        continue;
      }
      const manifest = (await file.json()) as {
        readonly name?: unknown;
        readonly private?: unknown;
      };
      if (manifest.private !== true && typeof manifest.name === "string") {
        names.add(manifest.name);
      }
    }

    for (const entry of libraryCatalog.filter((candidate) => candidate.trust === "official")) {
      expect(names.has(entry.name), entry.name).toBe(true);
    }
  });

  test("keeps names unique and entries complete", () => {
    const names = libraryCatalog.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);

    for (const entry of libraryCatalog) {
      expect(entry.description.trim()).not.toBe("");
      expect(entry.repository.startsWith("https://")).toBe(true);
      expect(entry.docs.startsWith("https://")).toBe(true);
      expect(entry.compatibility.aponia).not.toBe("");
      expect(entry.compatibility.elysia).not.toBe("");
      expect(entry.compatibility.bun).not.toBe("");
      expect(["official", "community-reviewed", "unverified"]).toContain(entry.trust);
    }
  });

  test("searches by name, description, and tag", () => {
    expect(searchLibraries("").length).toBe(libraryCatalog.length);
    expect(searchLibraries("security").map((entry) => entry.name)).toContain("@aponiajs/security");
    expect(searchLibraries("mcp").map((entry) => entry.name)).toContain("@aponiajs/mcp");
    expect(searchLibraries("no-such-library")).toEqual([]);
  });
});
