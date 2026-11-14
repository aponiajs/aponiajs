import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "..");
const workflowsDirectory = join(repositoryRoot, ".github", "workflows");

const shaPinnedReference = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;

/**
 * A workflow's `uses:` references, as written.
 *
 * A reusable workflow inside this repository resolves relatively, so it is not
 * a third-party supply-chain entry and is not checked here.
 */
async function externalUsesReferences(): Promise<readonly { file: string; reference: string }[]> {
  const references: { file: string; reference: string }[] = [];
  const entries = await readdir(workflowsDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) {
      continue;
    }
    const path = join(workflowsDirectory, entry.name);
    const text = await Bun.file(path).text();
    for (const match of text.matchAll(/^\s*uses:\s*(\S+)/gm)) {
      const reference = match[1];
      if (reference === undefined || reference.startsWith("./")) {
        continue;
      }
      references.push({ file: entry.name, reference });
    }
  }

  return references;
}

test("every third-party action is pinned to a commit SHA", async () => {
  const references = await externalUsesReferences();

  // A scan that stopped matching would otherwise pass by checking nothing.
  expect(references.length).toBeGreaterThan(0);
  expect(
    references.filter((entry) => !shaPinnedReference.test(entry.reference)),
    "workflow actions referenced by a moving tag",
  ).toEqual([]);
});
