import { readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, test } from "bun:test";

/**
 * The documentation set is browsable from one index.
 *
 * A page nothing links to is invisible on the published site even though it
 * exists in the repository and passes its own guards. This file holds the
 * category contract: one root index, one `README.md` per category, and every
 * page reachable from one of them.
 */
const repositoryRoot = join(import.meta.dir, "..");
const docsRoot = join(repositoryRoot, "docs");
const skippedNames = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const rootIndex = "README.md";
const linkPattern = /\]\(([^)\s]+)\)/g;

async function listPagePaths(directory: string): Promise<string[]> {
  const pages: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await listPagePaths(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && !skippedNames.has(entry.name)) {
      pages.push(relative(docsRoot, path).split(sep).join("/"));
    }
  }
  return pages;
}

function markdownLinks(page: string, content: string): readonly string[] {
  return [...content.matchAll(linkPattern)]
    .map((match) => match[1] ?? "")
    .filter((href) => !href.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(href))
    .map((href) => href.split("#")[0] ?? "")
    .filter((href) => href.endsWith(".md"))
    .map((href) => posix.normalize(posix.join(posix.dirname(page), href)));
}

const pages = await listPagePaths(docsRoot);
const pageSet = new Set(pages);
const rootContent = await Bun.file(join(docsRoot, rootIndex)).text();
const rootLinks = new Set(markdownLinks(rootIndex, rootContent));
const directories = [
  ...new Set(pages.map((page) => (page.includes("/") ? page.split("/")[0]! : ""))),
].filter((directory) => directory !== "");

const indexContents = new Map<string, string>();
for (const directory of directories) {
  const path = `${directory}/README.md`;
  if (pageSet.has(path)) {
    indexContents.set(path, await Bun.file(join(docsRoot, path)).text());
  }
}

const linkedPages = new Set<string>();
for (const [path, content] of indexContents) {
  for (const link of markdownLinks(path, content)) {
    linkedPages.add(link);
  }
}

describe("documentation index", () => {
  test("keeps the root of docs limited to its index", () => {
    const rootPages = pages.filter((page) => !page.includes("/"));

    expect(rootPages).toEqual([rootIndex]);
  });

  test("gives every category a README", () => {
    expect(directories.length).toBeGreaterThanOrEqual(6);
    for (const directory of directories) {
      expect(pageSet.has(`${directory}/README.md`), `${directory}/README.md`).toBe(true);
    }
  });

  test("links every category from the root index", () => {
    for (const directory of directories) {
      expect(rootLinks.has(`${directory}/README.md`), `${directory}/README.md`).toBe(true);
    }
  });

  test("reaches every page from the root index or its category README", () => {
    const unlinked = pages.filter(
      (page) => page !== rootIndex && !rootLinks.has(page) && !linkedPages.has(page),
    );

    expect(unlinked).toEqual([]);
  });

  test("links no page the set does not contain", () => {
    for (const [path, content] of [[rootIndex, rootContent] as const, ...indexContents.entries()]) {
      for (const link of markdownLinks(path, content)) {
        expect(pageSet.has(link), `${path} links ${link}`).toBe(true);
      }
    }

    expect(directories.length).toBeGreaterThan(0);
  });
});
