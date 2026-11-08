import { expect, spyOn, test } from "bun:test";
import { parseArguments, runCli } from "../src/index.ts";
import { searchLibraries } from "../src/library/catalog.ts";

test("parses library search", () => {
  expect(parseArguments(["library", "search", "security", "--json"])).toEqual({
    command: "library",
    action: "search",
    path: undefined,
    json: true,
    publish: false,
    query: "security",
  });
});

test("prints catalog search results as JSON", async () => {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    lines.push(String(message));
  });

  try {
    expect(await runCli(["library", "search", "security", "--json"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  const entries = JSON.parse(lines.join("\n")) as readonly { readonly name: string }[];
  expect(entries.map((entry) => entry.name)).toContain("@aponiajs/security");
  expect(searchLibraries("cache").map((entry) => entry.name)).toContain("@aponiajs/cache");
});
