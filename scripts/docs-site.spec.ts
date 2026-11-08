import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { buildDocsSite } from "./build-docs-site.ts";

const outputRoot = await mkdtemp(join(tmpdir(), "aponia-docs-site-"));
const built = await buildDocsSite({ docsRoot: "docs", outputRoot });

const skippedNames = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const skippedDirectories = new Set(["superpowers"]);

async function sourcePages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const pages: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        pages.push(...(await sourcePages(path)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md") && !skippedNames.has(entry.name)) {
      pages.push(relative("docs", path).split(sep).join("/").replace(/\.md$/, ".html"));
    }
  }
  return pages;
}

afterAll(async () => {
  await rm(outputRoot, { recursive: true, force: true });
});

describe("documentation site", () => {
  test("writes one page per document plus an index", async () => {
    const expected = await sourcePages("docs");

    expect(built.pages).toHaveLength(expected.length + 1);
    expect(built.pages).toContain("index.html");
    for (const page of expected) {
      expect(await Bun.file(join(outputRoot, page)).exists(), page).toBe(true);
    }
    expect(built.pages).toContain("learn/01-overview.html");
    expect(built.pages).toContain("agent/README.html");
  });

  test("indexes every page under its navigation group", async () => {
    const index = await readFile(join(outputRoot, "index.html"), "utf8");

    expect(index).toContain("<h2>Guide</h2>");
    expect(index).toContain("<h2>Learn</h2>");
    expect(index).toContain("<h2>Agent</h2>");
    expect(index).toContain('href="/auth.html"');
    expect(index).toContain('href="/learn/01-overview.html"');
    expect(index).toContain("bearer JWT authentication");
    expect(index).toContain('id="search"');
  });

  test("writes a search index and serves the search box on every page", async () => {
    const entries = JSON.parse(
      await readFile(join(outputRoot, "search-index.json"), "utf8"),
    ) as readonly {
      readonly path: string;
      readonly title: string;
      readonly headings: readonly string[];
      readonly text: string;
    }[];
    const auth = entries.find((entry) => entry.path === "/auth.html");
    const page = await readFile(join(outputRoot, "auth.html"), "utf8");

    expect(entries).toHaveLength((await sourcePages("docs")).length);
    expect(auth?.title).toBe("Authentication and Authorization");
    expect(auth?.headings).toContain("OpenID Connect");
    expect(auth?.text).toContain("bearer JWT authentication");
    expect(page).toContain('id="search"');
    expect(page).toContain("/search-index.json");
  });

  test("rewrites internal Markdown links and keeps external ones as GitHub links", async () => {
    const auth = await readFile(join(outputRoot, "auth.html"), "utf8");
    const learn = await readFile(join(outputRoot, "learn", "01-overview.html"), "utf8");

    expect(auth).not.toMatch(/href="(?!https?:)[^"]*\.md"/);
    expect(auth).toContain(
      "https://github.com/aponiajs/aponiajs/blob/main/packages/auth/README.md",
    );
    expect(learn).toContain('href="../architecture-and-style.html"');
  });

  test("chains the learning path and labels each page", async () => {
    const path = await readFile(join(outputRoot, "learn", "README.html"), "utf8");
    const first = await readFile(join(outputRoot, "learn", "01-overview.html"), "utf8");
    const last = await readFile(join(outputRoot, "learn", "16-lifecycle.html"), "utf8");

    expect(path).not.toContain('class="previous"');
    expect(path).toContain('href="/learn/01-overview.html"');
    expect(first).toContain("<title>01 · Overview · AponiaJS</title>");
    expect(first).toContain('href="/learn/02-install-and-generate.html"');
    expect(first).not.toMatch(/href="(?!https?:)[^"]*\.md"/);
    expect(last).toContain('class="previous"');
    expect(last).not.toContain('class="next"');
  });
});
