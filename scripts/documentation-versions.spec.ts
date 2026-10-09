import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

/**
 * The published surfaces a reader meets, and the one directory deliberately left
 * out of them.
 *
 * `docs/superpowers/` holds the specs and plans that record past decisions, so a
 * sample in one may name a release that was current when it was written. It is
 * outside the set by construction: no pattern below reaches it.
 */
const publishedSurfaces = [
  "README.md",
  "AGENTS.md",
  "docs/*.md",
  "docs/learn/*.md",
  "packages/*/README.md",
  "packages/*/AGENTS.md",
  "packages/*/llms.txt",
] as const;

/**
 * The keys whose value is this framework's own release.
 *
 * A generated artifact stamps itself with the release that wrote it, so a
 * document showing one is stating a fact about this repository's version — and a
 * stamp left behind by an earlier release describes an artifact this release
 * would refuse.
 *
 * The keys are the ones this repository stamps its own release under — `framework`
 * on a generated invoker or descriptor artifact, and `descriptors` on the boot
 * record that reports which descriptor artifact served a boot. They are an
 * allow-list rather than a scan for every version-shaped string,
 * because the same documents cite other projects' versions that are correct as
 * they stand: `docs/elysia-compatibility.md` pins `2.0.0-beta.24` for Elysia
 * beside `^1.3.0` for typebox, and the platform's own guide names
 * `2.0.0-exp.64` as the release a caret on that pin would reach. A guard
 * that policed every version-shaped string would fail on the day it was written.
 * What this file checks is narrower than "every version in a document",
 * and that is the boundary: a release named in prose, or under a key a generated
 * artifact does not write, is not checked here.
 */
const releaseKeys = ["framework", "descriptors"] as const;

/** The stamp a snippet writes for one of those keys, in single or double quotes. */
function stampsOf(content: string): readonly string[] {
  const stamps: string[] = [];

  for (const key of releaseKeys) {
    for (const match of content.matchAll(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`, "g"))) {
      const version = match[1];
      if (version !== undefined) {
        stamps.push(version);
      }
    }
  }

  return stamps;
}

describe("documentation versions", () => {
  test("every published stamp names the release running", async () => {
    const repositoryRoot = resolve(import.meta.dir, "..");
    const manifest = (await Bun.file(resolve(repositoryRoot, "package.json")).json()) as {
      readonly version?: unknown;
    };
    const version = manifest.version;

    expect(typeof version).toBe("string");
    if (typeof version !== "string") {
      return;
    }

    const stamped: { readonly path: string; readonly version: string }[] = [];

    for (const pattern of publishedSurfaces) {
      for await (const path of new Glob(pattern).scan({ cwd: repositoryRoot, onlyFiles: true })) {
        const content = await Bun.file(resolve(repositoryRoot, path)).text();

        for (const stamp of stampsOf(content)) {
          stamped.push({ path, version: stamp });
        }
      }
    }

    // The count is asserted before the versions are, because a guard that reads
    // nothing passes for the same reason a correct one does: the keys it looks
    // for could be renamed, and every sentence around it would still be true.
    expect(stamped.length).toBeGreaterThan(0);

    const stale = stamped.filter((entry) => entry.version !== version);

    expect(stale).toEqual([]);
  });
});
