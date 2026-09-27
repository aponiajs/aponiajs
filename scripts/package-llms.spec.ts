import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "..");
const packagesDirectory = join(repositoryRoot, "packages");

/**
 * The single workspace package that stays private and therefore ships no
 * `llms.txt`: `packages/aponiajs` is the reserved public facade, marked
 * `"private": true` in its manifest and deliberately unpublished. The guard
 * pins the exception to exactly this directory so a published package cannot
 * escape its `llms.txt` by going private instead.
 */
const privatePackageDirectories = ["packages/aponiajs"] as const;

const markdownLinkPattern = /\[[^\]]+\]\(([^)\s]+)\)/g;
const absoluteUrlPattern = /^[a-z][a-z0-9+.-]*:/i;
const repositoryBlobPrefix = "https://github.com/aponiajs/aponiajs/blob/";

interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly files?: readonly string[];
}

interface WorkspacePackage {
  readonly directory: string;
  readonly absoluteDirectory: string;
  readonly manifest: PackageManifest;
}

const workspacePackages = await listWorkspacePackages();
const publishedPackages = workspacePackages.filter(
  (workspacePackage) => workspacePackage.manifest.private !== true,
);

describe("package llms.txt", () => {
  test("ships an llms.txt at the root of every published package", async () => {
    for (const workspacePackage of publishedPackages) {
      const documentPath = join(workspacePackage.absoluteDirectory, "llms.txt");

      expect(await Bun.file(documentPath).exists(), `${workspacePackage.directory}/llms.txt`).toBe(
        true,
      );
    }
  });

  test("lists llms.txt in the manifest files array of every published package", () => {
    for (const workspacePackage of publishedPackages) {
      expect(
        workspacePackage.manifest.files ?? [],
        `${workspacePackage.directory}/package.json must pack llms.txt`,
      ).toContain("llms.txt");
    }
  });

  test("opens every llms.txt with its package name as an H1 and a blockquote summary", async () => {
    for (const workspacePackage of publishedPackages) {
      const document = await readLlmsDocument(workspacePackage);
      const [title = "", ...bodyLines] = document.trimStart().split("\n");
      const firstSectionIndex = bodyLines.findIndex((line) => line.startsWith("## "));
      const summaryLines = bodyLines.slice(
        0,
        firstSectionIndex === -1 ? bodyLines.length : firstSectionIndex,
      );

      expect(
        title,
        `${workspacePackage.directory}/llms.txt must open with "# ${workspacePackage.manifest.name}"`,
      ).toBe(`# ${workspacePackage.manifest.name}`);
      expect(
        summaryLines.find((line) => line.startsWith("> ") && line.trim().length > 2),
        `${workspacePackage.directory}/llms.txt must summarize the package in a blockquote before its first section`,
      ).toBeDefined();
    }
  });

  test("links only https URLs and repository paths that exist", async () => {
    for (const workspacePackage of publishedPackages) {
      const document = await readLlmsDocument(workspacePackage);
      const links = [...document.matchAll(markdownLinkPattern)].map((match) => match[1] ?? "");

      expect(
        links.length,
        `${workspacePackage.directory}/llms.txt must link its documentation`,
      ).toBeGreaterThan(0);

      for (const link of links) {
        const resolvedLink = await resolveDocumentLink(link, workspacePackage.absoluteDirectory);

        expect(
          resolvedLink,
          `${workspacePackage.directory}/llms.txt links ${link}, which does not exist`,
        ).toBeDefined();
      }
    }
  });

  test("keeps the private exception to the reserved facade", () => {
    const privateDirectories = workspacePackages
      .filter((workspacePackage) => workspacePackage.manifest.private === true)
      .map((workspacePackage) => workspacePackage.directory);

    expect(privateDirectories).toEqual([...privatePackageDirectories]);
    expect(publishedPackages.length).toBeGreaterThan(0);
  });
});

async function listWorkspacePackages(): Promise<readonly WorkspacePackage[]> {
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const workspacePackages = await Promise.all(names.map(readWorkspacePackage));

  return workspacePackages.filter(
    (workspacePackage): workspacePackage is WorkspacePackage => workspacePackage !== undefined,
  );
}

async function readWorkspacePackage(name: string): Promise<WorkspacePackage | undefined> {
  const absoluteDirectory = join(packagesDirectory, name);
  const manifestPath = join(absoluteDirectory, "package.json");
  if (!(await Bun.file(manifestPath).exists())) {
    return undefined;
  }

  return {
    directory: join("packages", name),
    absoluteDirectory,
    manifest: (await Bun.file(manifestPath).json()) as PackageManifest,
  };
}

function readLlmsDocument(workspacePackage: WorkspacePackage): Promise<string> {
  return Bun.file(join(workspacePackage.absoluteDirectory, "llms.txt")).text();
}

/**
 * Accepts an `https://` link, or a path inside this repository that exists when
 * resolved either from the package root (`../../docs/cli.md`) or from the
 * repository root (`docs/cli.md`). Every other absolute URL, including a plain
 * `http://` one, is rejected.
 *
 * A link into this repository's own source is checked further: the path behind
 * the branch or tag has to exist here. Without that, renaming or moving a
 * source file leaves a document advertising an export at a URL that 404s, and
 * nothing fails.
 */
async function resolveDocumentLink(
  link: string,
  packageDirectory: string,
): Promise<string | undefined> {
  if (link.startsWith("https://")) {
    if (!link.startsWith(repositoryBlobPrefix)) {
      return link;
    }

    return (await repositoryBlobTargetExists(link)) ? link : undefined;
  }
  if (absoluteUrlPattern.test(link)) {
    return undefined;
  }

  const [target = link] = link.split(/[?#]/);
  for (const base of [packageDirectory, repositoryRoot]) {
    const candidate = resolve(base, target);
    if (await Bun.file(candidate).exists()) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * The reference segment is not known ahead of time — `main` and `release/alpha`
 * both occur, and the latter contains a slash — so leading segments are
 * stripped until one leaves a path that exists in this repository.
 */
async function repositoryBlobTargetExists(link: string): Promise<boolean> {
  const [target = ""] = link.slice(repositoryBlobPrefix.length).split(/[?#]/);
  const segments = target.split("/").filter(Boolean);

  for (let index = 1; index < segments.length; index++) {
    const candidate = resolve(repositoryRoot, segments.slice(index).join("/"));
    if (await Bun.file(candidate).exists()) {
      return true;
    }
  }

  return false;
}
