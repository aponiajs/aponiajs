interface PublicApiEntry {
  readonly name: string;
  readonly kind: "type" | "value";
}

interface PublicApiPackage {
  readonly name: string;
  readonly exports: readonly PublicApiEntry[];
}

interface PublicApiSnapshot {
  readonly contractVersion: number;
  readonly packages: readonly PublicApiPackage[];
}

/** Code-unit ordering, so the page reads the same on every machine. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Renders the API reference from the frozen public-surface snapshot.
 *
 * The snapshot records names and whether each is a value or a type; it carries
 * no JSDoc. This page states exactly that and links to the package catalog, so
 * it never claims more than the snapshot holds. TypeDoc is not wired yet: its
 * current release does not support the TypeScript version this repository
 * builds with.
 *
 * @param snapshot - The parsed `docs/public-api.json`.
 * @returns The Markdown page.
 *
 * @internal
 */
export function renderApiReference(snapshot: PublicApiSnapshot): string {
  const packages = [...snapshot.packages].toSorted((left, right) => compare(left.name, right.name));
  const lines = [
    "# API Reference",
    "",
    "Every name each published package exports from its barrel, generated from",
    "`docs/public-api.json`. The snapshot records names and whether each is a",
    "value or a type; it does not carry JSDoc. The JSDoc-rendering reference is",
    "built by `tools/api-docs` and published at `/api/` in the documentation",
    "site. The package README and `aponia manifest` carry the contract behind a",
    "name.",
    "",
    `Snapshot contract version ${snapshot.contractVersion}.`,
    "",
  ];

  for (const pkg of packages) {
    lines.push(`## \`${pkg.name}\``, "");
    const exports = [...pkg.exports].toSorted((left, right) => compare(left.name, right.name));
    if (exports.length === 0) {
      lines.push("No public exports.", "");
      continue;
    }
    for (const entry of exports) {
      lines.push(`- \`${entry.name}\` (${entry.kind})`);
    }
    lines.push("");
  }

  lines.push("See [Packages](./packages.md) for what npm serves today.", "");
  return lines.join("\n");
}

/**
 * Writes the API reference, or checks that the committed page is current.
 *
 * @param options - `check` compares instead of writing; `output` names the file.
 * @returns The exit code: `0` on success, `1` for a stale page in check mode.
 *
 * @internal
 */
export async function writeApiReference(
  options: { readonly check?: boolean; readonly output?: string } = {},
): Promise<number> {
  const snapshot = (await Bun.file("docs/public-api.json").json()) as PublicApiSnapshot;
  const rendered = renderApiReference(snapshot);
  const output = options.output ?? "docs/api.md";

  if (options.check === true) {
    const existing = await Bun.file(output).text();
    if (existing !== rendered) {
      console.error(`${output} is stale; run bun run docs:api.`);
      return 1;
    }
    console.log(`${output} is current.`);
    return 0;
  }

  await Bun.write(output, rendered);
  console.log(`Wrote ${output}.`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await writeApiReference({ check: process.argv.includes("--check") });
}
