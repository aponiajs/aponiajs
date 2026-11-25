import { join } from "node:path";
import { aponiaVersion } from "../version.ts";
import type { GenerateCommandOptions } from "../interfaces/command.interface.ts";
import type { GenerateSchematicResult } from "../interfaces/schematic.interface.ts";

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

/**
 * Upgrades the Aponia packages a project depends on to the running release.
 *
 * The `upgrade` schematic and its `update` alias both land here. A `--tag`
 * names the release channel the pinned version must belong to; the manifest is
 * rewritten to the exact workspace release, because Aponia's packages share one
 * version and a range would let them drift apart.
 *
 * @param projectRoot - The project whose manifest is upgraded.
 * @param options - The parsed options; `tag`, `skipInstall`, and `dryRun` apply.
 * @returns The `UPDATE` change lines.
 * @throws A plain `Error` when the manifest is missing or the tag disagrees.
 */
export async function upgradeAponiaPackages(
  projectRoot: string,
  options: GenerateCommandOptions,
): Promise<GenerateSchematicResult> {
  const manifestPath = join(projectRoot, "package.json");
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    throw new Error(`Could not find "package.json" in "${projectRoot}".`);
  }

  assertTag(options.tag);
  const manifest = (await file.json()) as PackageManifest;
  const updated: PackageManifest = {
    ...manifest,
    ...rewriteDependencies(manifest.dependencies),
    ...rewriteDependencies(manifest.devDependencies, "devDependencies"),
    ...rewriteDependencies(manifest.peerDependencies, "peerDependencies"),
    ...rewriteDependencies(manifest.optionalDependencies, "optionalDependencies"),
  };

  const changes: { kind: "CREATE" | "UPDATE"; path: string }[] = [];
  if (!options.dryRun) {
    await Bun.write(manifestPath, `${JSON.stringify(updated, undefined, 2)}\n`);
    changes.push({ kind: "UPDATE", path: "package.json" });

    if (options.skipInstall !== true) {
      const install = Bun.spawn(["bun", "install"], {
        cwd: projectRoot,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await install.exited) !== 0) {
        throw new Error("The package manager failed after upgrading the Aponia packages.");
      }
    }
  } else {
    changes.push({ kind: "UPDATE", path: "package.json" });
  }

  return { changes, dryRun: options.dryRun };
}

function rewriteDependencies(
  dependencies: Readonly<Record<string, string>> | undefined,
  key = "dependencies",
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  if (dependencies === undefined) {
    return {};
  }
  const updated: Record<string, string> = {};
  for (const [name, range] of Object.entries(dependencies)) {
    updated[name] = isAponiaPackage(name) ? aponiaVersion : range;
  }
  return { [key]: Object.freeze(updated) };
}

function isAponiaPackage(name: string): boolean {
  return name.startsWith("@aponiajs/") || name === "aponiajs";
}

function assertTag(tag: string | undefined): void {
  if (tag === undefined) {
    return;
  }
  const channel = channelOf(aponiaVersion);
  if (tag !== channel && !(tag === "latest" && channel === "latest")) {
    throw new Error(
      `The Aponia packages are pinned to ${aponiaVersion} (${channel}); "--tag ${tag}" does not match this release.`,
    );
  }
}

function channelOf(version: string): string {
  const prerelease = /^\d+\.\d+\.\d+-([a-z]+)\.\d+$/.exec(version)?.[1];
  return prerelease ?? "latest";
}
