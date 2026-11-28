import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

/**
 * The facts the catalog pages state about this repository's own packages.
 *
 * Counts drift silently because no compiler reads a Markdown table. This guard
 * derives every number from the workspace and the committed documents, so a new
 * package, a publication, or a version bump either moves the prose or fails
 * here.
 */
const repositoryRoot = join(import.meta.dir, "..");
const packagesRoot = join(repositoryRoot, "packages");

interface Manifest {
  readonly name?: unknown;
  readonly private?: unknown;
}

interface Workspace {
  readonly publishable: string[];
  readonly privatePackages: string[];
}

async function workspace(): Promise<Workspace> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const publishable: string[] = [];
  const privatePackages: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    if (!(await Bun.file(manifestPath).exists())) {
      continue;
    }
    const manifest = (await Bun.file(manifestPath).json()) as Manifest;
    if (typeof manifest.name !== "string") {
      continue;
    }
    if (manifest.private === true) {
      privatePackages.push(manifest.name);
    } else {
      publishable.push(manifest.name);
    }
  }

  return { publishable: publishable.sort(), privatePackages: privatePackages.sort() };
}

function section(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `missing section "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = content.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

function packageNames(text: string): readonly string[] {
  return [...text.matchAll(/^\|\s*`(@aponiajs\/[^`]+|create-aponia)`/gm)].map(
    (match) => match[1] as string,
  );
}

describe("documentation claims", () => {
  test("the release list is exactly the publishable workspace packages", async () => {
    const document = await Bun.file(join(repositoryRoot, "docs/operations/releasing.md")).text();
    const listed = [...document.matchAll(/^\d+\.\s+`(@aponiajs\/[a-z0-9-]+|create-aponia)`/gm)].map(
      (match) => match[1] as string,
    );

    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed).size, "the release list names a package twice").toBe(listed.length);
    expect([...listed].sort()).toEqual((await workspace()).publishable);
  });

  test("the feature-status table covers every publishable package and no other", async () => {
    const document = await Bun.file(
      join(repositoryRoot, "docs/reference/feature-status.md"),
    ).text();
    const stated = packageNames(document);
    const expected = (await workspace()).publishable;

    expect([...stated].sort()).toEqual(expected);
  });

  test("the package catalog counts match the workspace and npm latest release", async () => {
    const document = await Bun.file(join(repositoryRoot, "docs/reference/packages.md")).text();
    const published = packageNames(section(document, "## Published packages"));
    const packages = await workspace();

    expect([...published].sort()).toEqual(packages.publishable);
    expect(packages.publishable).toHaveLength(39);
    expect(packages.privatePackages).toEqual(["aponiajs"]);

    expect(document).toContain("39 publishable packages");
    expect(document).toContain("1 private facade");
    expect(document).toContain("All 39 publishable packages ship together");
  });

  test("the library sample states the workspace version", async () => {
    const document = await Bun.file(join(repositoryRoot, "docs/tooling/libraries.md")).text();
    const manifest = (await Bun.file(join(repositoryRoot, "package.json")).json()) as {
      readonly version?: unknown;
    };
    const sample = /"aponia":\s*"([^"]+)"/.exec(document)?.[1];

    const version = manifest.version;
    expect(typeof version).toBe("string");
    if (typeof version !== "string") {
      return;
    }
    expect(sample).toBe(version);
  });
});
