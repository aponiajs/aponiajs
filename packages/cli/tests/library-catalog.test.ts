import { expect, spyOn, test } from "bun:test";
import { parseArguments, runCli } from "../src/index.ts";
import { searchLibraries, searchRemoteLibraries } from "../src/library/catalog.ts";

test("parses library search", () => {
  expect(parseArguments(["library", "search", "security", "--json"])).toEqual({
    command: "library",
    action: "search",
    path: undefined,
    json: true,
    publish: false,
    query: "security",
    remote: false,
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

test("searches npm keywords and marks community results unverified", async () => {
  const entries = await searchRemoteLibraries(
    "widgets",
    async () =>
      new Response(
        JSON.stringify({
          objects: [
            {
              package: {
                name: "@acme/widgets",
                description: "Widgets for AponiaJS",
                keywords: ["aponia-library", "plugin"],
                links: {
                  repository: "https://github.com/acme/widgets",
                  npm: "https://npmjs.com/package/@acme/widgets",
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ name: "@acme/widgets", kind: "plugin", trust: "unverified" });
});
