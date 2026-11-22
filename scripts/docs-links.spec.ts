import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { headingIdsOf } from "./build-docs-site.ts";

/**
 * Every link a reader can follow through the documentation set.
 *
 * A Markdown file compiles to nothing, so a moved page leaves `404`s behind
 * unless a guard walks the links. This file resolves each link against the real
 * tree, renders the target with the same `marked` configuration the site uses,
 * and checks the fragment against the heading identifiers that renderer emits.
 */
const repositoryRoot = resolve(import.meta.dir, "..");
const docsRoot = join(repositoryRoot, "docs");
const redirectMapPath = join(docsRoot, "redirects.json");
const repositoryBlobPrefix = "https://github.com/aponiajs/aponiajs/blob/";
const ignoredNames = new Set(["CLAUDE.md", "GEMINI.md"]);
const linkPattern = /(!?\[[^\]]*\]\()([^)\s]+)(\))/g;
const absoluteUrlPattern = /^[a-z][a-z0-9+.-]*:/i;

const surfaces = [
  "README.md",
  "SECURITY.md",
  "ROADMAP.md",
  "CONTRIBUTING.md",
  "llms.txt",
  "docs/**/*.md",
  "packages/*/README.md",
  "packages/*/llms.txt",
  "packages/*/AGENTS.md",
  "examples/**/*.md",
] as const;

async function listSurfaces(): Promise<readonly string[]> {
  const paths = new Set<string>();
  for (const pattern of surfaces) {
    for await (const path of new Glob(pattern).scan({ cwd: repositoryRoot, onlyFiles: true })) {
      if (!ignoredNames.has(path.split("/").at(-1) ?? "")) {
        paths.add(path.split(sep).join("/"));
      }
    }
  }
  return Object.freeze([...paths].toSorted());
}

function withoutCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

interface Link {
  readonly href: string;
}

function linksOf(content: string): readonly Link[] {
  return [...withoutCode(content).matchAll(linkPattern)].map((match) => ({
    href: match[2] ?? "",
  }));
}

function isFile(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await readdir(path)) !== undefined;
  } catch {
    return false;
  }
}

function splitHref(href: string): { readonly target: string; readonly fragment?: string } {
  const [target = "", fragment] = href.split("#");
  return { target, fragment };
}

async function blobTarget(
  link: string,
): Promise<{ readonly path: string; readonly fragment?: string } | undefined> {
  if (!link.startsWith(repositoryBlobPrefix)) {
    return undefined;
  }
  const rest = link.slice(repositoryBlobPrefix.length);
  const { target, fragment } = splitHref(rest);
  const segments = target.split("/").filter(Boolean);
  const knownRefs = ["refs/heads/main", "release/alpha", "release/beta", "release/rc", "main"];
  for (const ref of knownRefs) {
    const prefix = `${ref}/`;
    if (target.startsWith(prefix)) {
      return { path: target.slice(prefix.length), fragment };
    }
  }
  if (segments.length < 2) {
    return { path: target, fragment };
  }
  return { path: segments.slice(1).join("/"), fragment };
}

async function anchorExists(path: string, fragment: string): Promise<boolean> {
  const markdown = await Bun.file(join(repositoryRoot, path)).text();
  return headingIdsOf(markdown).includes(fragment);
}

const files = await listSurfaces();

describe("documentation links", () => {
  test("every relative link resolves to a file or directory", async () => {
    const failures: string[] = [];

    for (const file of files) {
      const content = await Bun.file(join(repositoryRoot, file)).text();
      for (const { href } of linksOf(content)) {
        if (href.startsWith("#") || href.startsWith("/") || absoluteUrlPattern.test(href)) {
          continue;
        }
        const { target } = splitHref(href);
        if (target === "") {
          continue;
        }
        const absolute = resolve(dirname(join(repositoryRoot, file)), target);
        const exists = (await isFile(absolute)) || (await isDirectory(absolute));
        if (!exists) {
          failures.push(`${file}: ${href}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("every fragment names a heading the site renders", async () => {
    const failures: string[] = [];

    for (const file of files) {
      const content = await Bun.file(join(repositoryRoot, file)).text();
      for (const { href } of linksOf(content)) {
        const { target, fragment } = splitHref(href);
        if (fragment === undefined || fragment === "") {
          continue;
        }
        if (absoluteUrlPattern.test(href) && !href.startsWith(repositoryBlobPrefix)) {
          continue;
        }

        let targetFile: string | undefined;
        if (href.startsWith("#")) {
          targetFile = file;
        } else if (href.startsWith(repositoryBlobPrefix)) {
          targetFile = (await blobTarget(href))?.path;
        } else if (!href.startsWith("/")) {
          targetFile = relative(
            repositoryRoot,
            resolve(dirname(join(repositoryRoot, file)), target),
          )
            .split(sep)
            .join("/");
        }

        if (targetFile === undefined) {
          continue;
        }
        if (!(await isFile(join(repositoryRoot, targetFile)))) {
          failures.push(`${file}: ${href} names a missing file`);
          continue;
        }
        if (!(await anchorExists(targetFile, fragment))) {
          failures.push(`${file}: ${href} names a missing heading`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("every absolute link into this repository names a file that exists", async () => {
    const failures: string[] = [];

    for (const file of files) {
      const content = await Bun.file(join(repositoryRoot, file)).text();
      for (const { href } of linksOf(content)) {
        const target = await blobTarget(href);
        if (target === undefined) {
          continue;
        }
        if (!(await isFile(join(repositoryRoot, target.path)))) {
          failures.push(`${file}: ${href}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("the redirect map names real pages and never shadows one", async () => {
    const redirects = (await Bun.file(redirectMapPath).json()) as Record<string, string>;
    const entries = Object.entries(redirects);

    expect(entries.length).toBeGreaterThan(0);

    for (const [from, to] of entries) {
      expect(from.endsWith(".md"), from).toBe(true);
      expect(to.endsWith(".md"), to).toBe(true);
      expect(from, `${from} points at itself`).not.toBe(to);
      expect(await isFile(join(docsRoot, to)), `${from} -> ${to} is missing`).toBe(true);
      expect(await isFile(join(docsRoot, from)), `${from} shadows a real page`).toBe(false);
    }
  });

  test("the scan reaches the documents it claims to guard", () => {
    expect(files).toContain("docs/README.md");
    expect(files).toContain("docs/services/auth.md");
    expect(files).toContain("packages/common/README.md");
    expect(files).toContain("packages/platform-elysia/llms.txt");
  });
});
