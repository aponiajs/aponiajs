/**
 * Builds the static documentation site from `docs/`.
 *
 * The generator reads the published Markdown, renders it with `marked`, and
 * writes one HTML page per document under a `docs-site/` output directory. It
 * owns no content of its own: the navigation, the index, and every page come
 * from the files the documentation guards already keep honest.
 *
 * ```bash
 * bun run docs:build
 * ```
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { marked } from "marked";

/** Where a document belongs in the navigation. */
type DocsGroup = string;

interface DocsPage {
  readonly source: string;
  readonly relativeSource: string;
  readonly output: string;
  readonly title: string;
  readonly description: string;
  readonly group: DocsGroup;
  readonly order: number;
}

/** Options `buildDocsSite` accepts. */
export interface DocsSiteOptions {
  /** The documentation directory to read; defaults to `docs`. */
  readonly docsRoot?: string;
  /** The directory the site is written to; defaults to `docs-site`. */
  readonly outputRoot?: string;
  /** Where the build reports what it wrote. */
  readonly log?: (message: string) => void;
}

/** What one build produced. */
export interface DocsSiteResult {
  readonly pages: readonly string[];
  readonly index: string;
  /** The client-side search document the site loads. */
  readonly searchIndex: string;
}

const skippedFiles = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const skippedDirectories = new Set(["superpowers"]);
const groupOrder: readonly string[] = ["Guide", "Learn", "Agent"];
const repositoryBlob = "https://github.com/aponiajs/aponiajs/blob/main";

export async function buildDocsSite(options: DocsSiteOptions = {}): Promise<DocsSiteResult> {
  const docsRoot = resolve(options.docsRoot ?? "docs");
  const outputRoot = resolve(options.outputRoot ?? "docs-site");
  const pages = await collectPages(docsRoot);
  const ordered = orderPages(pages);
  const navigation = renderNavigation(ordered);
  const searchEntries: SearchEntry[] = [];

  for (const page of ordered) {
    const markdown = await readFile(page.source, "utf8");
    searchEntries.push(searchEntryOf(page, markdown));
    const body = rewriteLinks(renderMarkdown(markdown), page, ordered, docsRoot);
    const siblings = ordered.filter((candidate) => candidate.group === page.group);
    const position = siblings.indexOf(page);
    const html = renderPage(
      page,
      body,
      navigation,
      navigationLink(siblings, position - 1),
      navigationLink(siblings, position + 1),
    );
    const destination = join(outputRoot, page.output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html);
  }

  const index = join(outputRoot, "index.html");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(index, renderIndex(ordered, navigation));
  await writeFile(join(outputRoot, "search-index.json"), `${JSON.stringify(searchEntries)}\n`);

  const log = options.log ?? (() => {});
  log(`Built ${ordered.length + 1} documentation pages in ${outputRoot}.`);
  return Object.freeze({
    pages: Object.freeze([...ordered.map((page) => page.output), "index.html"]),
    index: "index.html",
    searchIndex: "search-index.json",
  });
}

interface SearchEntry {
  readonly path: string;
  readonly title: string;
  readonly headings: readonly string[];
  readonly text: string;
}

function searchEntryOf(page: DocsPage, markdown: string): SearchEntry {
  const headings = [...markdown.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) =>
    (match[1] ?? "").trim(),
  );
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[#|>\-*]+\s*/gm, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, " $1 ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  return Object.freeze({
    path: `/${page.output.split(sep).join("/")}`,
    title: page.title,
    headings: Object.freeze(headings),
    text,
  });
}

async function collectPages(docsRoot: string): Promise<DocsPage[]> {
  const files = await listMarkdown(docsRoot);
  const pages: DocsPage[] = [];
  for (const source of files) {
    const markdown = await readFile(source, "utf8");
    const relativeSource = relative(docsRoot, source).split(sep).join("/");
    const group = groupOf(relativeSource);
    pages.push({
      source,
      relativeSource,
      output: relativeSource.replace(/\.md$/, ".html"),
      title: titleOf(markdown, relativeSource),
      description: descriptionOf(markdown),
      group,
      order: orderOf(relativeSource),
    });
  }
  return pages;
}

async function listMarkdown(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...(await listMarkdown(path)));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && !skippedFiles.has(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function groupOf(relativeSource: string): DocsGroup {
  const [first] = relativeSource.split("/");
  if (first === undefined || relativeSource === first) {
    return "Guide";
  }
  if (first === "learn") {
    return "Learn";
  }
  if (first === "agent") {
    return "Agent";
  }
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function orderOf(relativeSource: string): number {
  const name = relativeSource.split("/").at(-1) ?? relativeSource;
  if (name === "README.md") {
    return -1;
  }
  const match = /^(\d+)-/.exec(name);
  return match?.[1] === undefined ? Number.POSITIVE_INFINITY : Number(match[1]);
}

function orderPages(pages: readonly DocsPage[]): DocsPage[] {
  return [...pages].toSorted((left, right) => {
    const group = groupRank(left.group) - groupRank(right.group);
    if (group !== 0) {
      return group;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.relativeSource.localeCompare(right.relativeSource);
  });
}

function groupRank(group: string): number {
  const index = groupOrder.indexOf(group);
  return index === -1 ? groupOrder.length : index;
}

function titleOf(markdown: string, relativeSource: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim() ?? relativeSource.replace(/\.md$/, "").replaceAll("-", " ");
}

function descriptionOf(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const line = block.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("|") || line.startsWith("```")) {
      continue;
    }
    const text = line
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") {
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }
  }
  return "";
}

function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true });
}

function rewriteLinks(
  html: string,
  page: DocsPage,
  pages: readonly DocsPage[],
  docsRoot: string,
): string {
  return html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (!href.includes(".md")) {
      return match;
    }
    const [target, hash] = href.split("#");
    if (target === undefined || target === "" || target.startsWith("http")) {
      return match;
    }
    const absolute = resolve(docsRoot, dirname(page.relativeSource), target);
    const inside = relative(docsRoot, absolute);
    if (inside.startsWith("..")) {
      const repositoryPath = relative(resolve(docsRoot, ".."), absolute).split(sep).join("/");
      const suffix = hash === undefined ? "" : `#${hash}`;
      return `href="${repositoryBlob}/${repositoryPath}${suffix}"`;
    }
    const known = pages.some((candidate) => candidate.relativeSource === inside);
    if (!known) {
      return match;
    }
    const destination = inside.replace(/\.md$/, ".html");
    const fromDirectory = dirname(page.output);
    const link = relative(fromDirectory === "." ? "" : fromDirectory, destination)
      .split(sep)
      .join("/");
    const suffix = hash === undefined ? "" : `#${hash}`;
    return `href="${link.startsWith(".") ? link : `./${link}`}${suffix}"`;
  });
}

function navigationLink(
  pages: readonly DocsPage[],
  index: number,
): { readonly href: string; readonly label: string } | undefined {
  const page = pages[index];
  if (page === undefined) {
    return undefined;
  }
  return Object.freeze({ href: `/${page.output}`, label: page.title });
}

function renderNavigation(pages: readonly DocsPage[]): string {
  const groups = new Map<string, DocsPage[]>();
  for (const page of pages) {
    const existing = groups.get(page.group);
    if (existing === undefined) {
      groups.set(page.group, [page]);
    } else {
      existing.push(page);
    }
  }
  const entries = [...groups.entries()].toSorted(
    ([left], [right]) => groupRank(left) - groupRank(right) || left.localeCompare(right),
  );
  const sections = entries.map(([group, members]) => {
    const links = members
      .map(
        (page) =>
          `<li><a href="/${page.output.split(sep).join("/")}">${escapeHtml(page.title)}</a></li>`,
      )
      .join("");
    return `<section><h2>${escapeHtml(group)}</h2><ul>${links}</ul></section>`;
  });
  return `<nav><a class="brand" href="/index.html">AponiaJS</a><label class="search"><input id="search" type="search" placeholder="Search documentation" aria-label="Search documentation" autocomplete="off"></label><ul id="search-results" class="search-results" hidden></ul>${sections.join("")}${searchScript}</nav>`;
}

const searchScript = `<script>
(() => {
  const input = document.getElementById("search");
  const results = document.getElementById("search-results");
  if (!input || !results) return;
  let index;
  const render = (matches) => {
    results.replaceChildren();
    if (!input.value.trim() || matches.length === 0) {
      results.hidden = true;
      return;
    }
    for (const entry of matches.slice(0, 12)) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.href = entry.path;
      anchor.textContent = entry.title;
      item.append(anchor);
      results.append(item);
    }
    results.hidden = false;
  };
  input.addEventListener("input", async () => {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      render([]);
      return;
    }
    index ??= await fetch("/search-index.json")
      .then((response) => response.json())
      .catch(() => []);
    render(
      index.filter((entry) =>
        [entry.title, ...entry.headings, entry.text]
          .join(" ")
          .toLowerCase()
          .includes(query),
      ),
    );
  });
})();
</script>`;

function renderPage(
  page: DocsPage,
  body: string,
  navigation: string,
  previous: { readonly href: string; readonly label: string } | undefined,
  next: { readonly href: string; readonly label: string } | undefined,
): string {
  const footer = [previous, next]
    .map((link, index) =>
      link === undefined
        ? ""
        : `<a class="${index === 0 ? "previous" : "next"}" href="${link.href}"><span>${index === 0 ? "Previous" : "Next"}</span>${escapeHtml(link.label)}</a>`,
    )
    .join("");
  return layout(
    page.title,
    `${navigation}<main><article>${body}</article>${footer === "" ? "" : `<footer>${footer}</footer>`}</main>`,
  );
}

function renderIndex(pages: readonly DocsPage[], navigation: string): string {
  const groups = new Map<string, DocsPage[]>();
  for (const page of pages) {
    const existing = groups.get(page.group);
    if (existing === undefined) {
      groups.set(page.group, [page]);
    } else {
      existing.push(page);
    }
  }
  const entries = [...groups.entries()].toSorted(
    ([left], [right]) => groupRank(left) - groupRank(right) || left.localeCompare(right),
  );
  const sections = entries.map(([group, members]) => {
    const cards = members
      .map((page) => {
        const description = page.description === "" ? "" : `<p>${escapeHtml(page.description)}</p>`;
        return `<li><a href="/${page.output.split(sep).join("/")}"><h3>${escapeHtml(page.title)}</h3>${description}</a></li>`;
      })
      .join("");
    return `<section><h2>${escapeHtml(group)}</h2><ul class="cards">${cards}</ul></section>`;
  });
  const body = `<p class="lede">The AponiaJS reference, the guided learning path, and the agent surface, generated from the repository's own Markdown.</p>${sections.join("")}`;
  return layout("AponiaJS documentation", `${navigation}<main>${body}</main>`);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · AponiaJS</title>
<style>${styles}</style>
</head>
<body>${body}</body>
</html>
`;
}

const styles = `
:root { color-scheme: light dark; --fg: #16181d; --muted: #5c6270; --bg: #ffffff; --panel: #f6f7f9; --line: #e2e5ea; --accent: #2d5bff; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e8ee; --muted: #9aa1b0; --bg: #0f1115; --panel: #171a21; --line: #262b36; --accent: #7d9bff; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
nav { padding: 24px 20px; background: var(--panel); border-right: 1px solid var(--line); position: sticky; top: 0; height: 100vh; overflow-y: auto; }
nav .brand { display: block; font-weight: 700; font-size: 1.1rem; margin-bottom: 20px; color: var(--fg); text-decoration: none; letter-spacing: -0.01em; }
nav h2 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 22px 0 8px; }
nav ul { list-style: none; margin: 0; padding: 0; }
nav .search { display: block; margin: 0 0 10px; }
nav .search input { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-size: 0.9rem; }
nav .search-results { list-style: none; margin: 0 0 10px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
nav .search-results li a { padding: 5px 8px; }
nav li a { display: block; padding: 4px 8px; border-radius: 6px; color: var(--fg); text-decoration: none; font-size: 0.92rem; }
nav li a:hover { background: var(--line); }
main { padding: 40px 48px 96px; max-width: 900px; }
article h1 { font-size: 2rem; letter-spacing: -0.02em; margin-top: 0; }
article h2 { margin-top: 2.2rem; letter-spacing: -0.01em; }
article a { color: var(--accent); }
article code { font-size: 0.88em; background: var(--panel); padding: 1px 5px; border-radius: 4px; }
article pre { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; overflow-x: auto; }
article pre code { background: none; padding: 0; }
article table { border-collapse: collapse; display: block; overflow-x: auto; margin: 1.2rem 0; }
article th, article td { border: 1px solid var(--line); padding: 7px 12px; text-align: left; }
article blockquote { margin: 1.2rem 0; padding: 2px 16px; border-left: 3px solid var(--accent); color: var(--muted); }
.lede { color: var(--muted); font-size: 1.05rem; max-width: 60ch; }
.cards { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.cards li a { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 16px; text-decoration: none; color: var(--fg); height: 100%; }
.cards li a:hover { border-color: var(--accent); }
.cards h3 { margin: 0 0 6px; font-size: 1rem; }
.cards p { margin: 0; color: var(--muted); font-size: 0.92rem; }
footer { display: flex; justify-content: space-between; gap: 24px; border-top: 1px solid var(--line); margin-top: 48px; padding-top: 20px; }
footer a { text-decoration: none; max-width: 45%; }
footer span { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
footer .next { margin-left: auto; text-align: right; }
@media (max-width: 760px) { body { grid-template-columns: 1fr; } nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); } main { padding: 24px 20px 64px; } }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (import.meta.main) {
  await buildDocsSite({ log: (message) => console.log(message) });
}
