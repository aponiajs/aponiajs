import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
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
    expect(built.pages).toContain("build/README.html");
    expect(built.pages).toContain("services/auth.html");
  });

  test("indexes every page under its navigation group", async () => {
    const index = await readFile(join(outputRoot, "index.html"), "utf8");

    for (const group of [
      "Guide",
      "Learn",
      "Build",
      "Platforms",
      "Services",
      "Tooling",
      "Operations",
      "Reference",
      "Agent",
    ]) {
      expect(index).toContain(`<h2>${group}</h2>`);
    }
    expect(index).toContain('href="/build/architecture-and-style.html"');
    expect(index).toContain('href="/platforms/adapters.html"');
    expect(index).toContain('href="/services/auth.html"');
    expect(index).toContain('href="/tooling/cli.html"');
    expect(index).toContain('href="/operations/deployment.html"');
    expect(index).toContain('href="/reference/packages.html"');
    expect(index).toContain('href="/learn/01-overview.html"');
    expect(index).toContain("bearer JWT authentication");
    expect(index).toContain('id="search"');
  });

  test("serves an old URL as a redirect that is not a page or a search entry", async () => {
    const redirect = await readFile(join(outputRoot, "auth.html"), "utf8");
    const entries = JSON.parse(
      await readFile(join(outputRoot, "search-index.json"), "utf8"),
    ) as readonly { readonly path: string }[];

    expect(built.redirects).toContain("auth.html");
    expect(built.pages).not.toContain("auth.html");
    expect(entries.map((entry) => entry.path)).not.toContain("/auth.html");

    expect(redirect).toContain('<link rel="canonical" href="/services/auth.html">');
    expect(redirect).toContain('<meta name="robots" content="noindex">');
    expect(redirect).toContain('<meta http-equiv="refresh" content="0; url=/services/auth.html">');
    expect(redirect).toContain(
      'location.replace("/services/auth.html" + location.search + location.hash)',
    );
    expect(redirect).toContain("Authentication and Authorization");
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
    const auth = entries.find((entry) => entry.path === "/services/auth.html");
    const page = await readFile(join(outputRoot, "services", "auth.html"), "utf8");

    expect(entries).toHaveLength((await sourcePages("docs")).length);
    expect(auth?.title).toBe("Authentication and Authorization");
    expect(auth?.headings).toContain("OpenID Connect");
    expect(auth?.text).toContain("bearer JWT authentication");
    expect(page).toContain('id="search"');
    expect(page).toContain("/search-index.json");
  });

  test("renders heading identifiers that anchors can reach", async () => {
    const auth = await readFile(join(outputRoot, "services", "auth.html"), "utf8");
    const learn = await readFile(join(outputRoot, "learn", "01-overview.html"), "utf8");
    const logging = await readFile(join(outputRoot, "build", "logging.html"), "utf8");

    expect(auth).toContain('id="openid-connect"');
    expect(logging).toContain('id="custom-logger"');
    expect(logging).toContain('href="#custom-logger"');
    expect(learn).toContain('href="../build/architecture-and-style.html"');
  });

  test("rewrites internal Markdown links and keeps external ones as GitHub links", async () => {
    const auth = await readFile(join(outputRoot, "services", "auth.html"), "utf8");
    const learn = await readFile(join(outputRoot, "learn", "01-overview.html"), "utf8");

    expect(auth).not.toMatch(/href="(?!https?:)[^"]*\.md"/);
    expect(auth).toContain(
      "https://github.com/aponiajs/aponiajs/blob/main/packages/auth/README.md",
    );
    expect(learn).not.toMatch(/href="(?!https?:)[^"]*\.md"/);
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

  test("opens the new category index pages", async () => {
    for (const category of [
      "build",
      "platforms",
      "services",
      "tooling",
      "operations",
      "reference",
    ]) {
      const content = await readFile(join(outputRoot, category, "README.html"), "utf8");
      expect(content).toContain(
        `<title>${category[0]!.toUpperCase()}${category.slice(1)} · AponiaJS</title>`,
      );
      expect(content).toContain("documentation index");
    }
  });
});

describe("documentation site redirects", () => {
  async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-"));
    for (const [path, content] of Object.entries(files)) {
      const destination = join(root, path);
      await mkdir(join(destination, ".."), { recursive: true });
      await writeFile(destination, content);
    }
    return root;
  }

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (cause) {
      return cause instanceof Error ? cause : new Error(String(cause));
    }
    throw new Error("Expected the build to fail.");
  }

  test("refuses a docs tree without a redirect map", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n\n[Page](./page.md)\n",
      "page.md": "# Page\n",
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("Missing redirect map");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("refuses a target that does not exist", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "page.md": "# Page\n",
      "redirects.json": JSON.stringify({ "old.md": "missing.md" }),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("points at missing page");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("refuses a redirect that shadows a real page", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "page.md": "# Page\n",
      "redirects.json": JSON.stringify({ "page.md": "README.md" }),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("collides with a real page");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("refuses a redirect that points at itself", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "page.md": "# Page\n",
      "redirects.json": JSON.stringify({ "old.md": "old.md" }),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("points at itself");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("refuses a redirect map that is not an object", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "redirects.json": JSON.stringify(["old.md", "README.md"]),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("must be a JSON object");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("refuses a target that is not a string", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "redirects.json": JSON.stringify({ "old.md": 42 }),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("must be a string");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("refuses a redirect that does not name Markdown pages", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "redirects.json": JSON.stringify({ "old.html": "README.md" }),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const error = await rejection(buildDocsSite({ docsRoot, outputRoot: output }));
      expect(error.message).toContain("must name Markdown pages");
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  test("serves a redirect that is not counted as a page", async () => {
    const docsRoot = await fixture({
      "README.md": "# Root\n",
      "page.md": "# Page\n",
      "redirects.json": JSON.stringify({ "old.md": "page.md" }),
    });
    const output = await mkdtemp(join(tmpdir(), "aponia-docs-redirect-out-"));
    try {
      const result = await buildDocsSite({ docsRoot, outputRoot: output });
      const redirect = await readFile(join(output, "old.html"), "utf8");

      expect(result.pages).toEqual(["README.html", "page.html", "index.html"]);
      expect(result.redirects).toEqual(["old.html"]);
      expect(redirect).toContain(
        'location.replace("/page.html" + location.search + location.hash)',
      );
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });
});
