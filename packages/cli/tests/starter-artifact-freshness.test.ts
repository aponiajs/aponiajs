import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateInvokers, generateProject } from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

/**
 * The one field of a committed artifact that cannot be compared.
 *
 * Everything else in `invokers.generated.ts` is decided by this package: the
 * framework stamp comes from `version.ts` and the invokers come from the
 * project's own source. `elysia` is resolved from what the project has
 * installed, so it is a fact about the machine rather than about this
 * repository, and it is provenance the platform never re-reads
 * (`packages/platform-elysia/src/routing/invoker-artifact.ts` records it only to
 * name both sides in a refusal). A difference there cannot change what an
 * application does, which is why the comparison below normalizes it and nothing
 * else.
 */
const elysiaStamp = /^ {2}elysia: .*,$/m;

/**
 * Guards the optimization, not safety.
 *
 * The starter commits the two modules a build writes, so a freshly generated
 * application answers through generated route invokers without a build having
 * run. The runtime is already safe against a stale artifact: `invoker-artifact.ts`
 * compares the artifact's framework stamp with the release that is running,
 * refuses the artifact whole when they differ, and compiles every route from
 * decorator metadata instead. Losing that comparison is therefore not a wrong
 * answer — it is a slower cold start that nothing reports. This test is what
 * notices: it fails when the committed modules stop being what the generator
 * produces today, which is the state that would make every newly generated
 * application silently stop using them.
 */
test("the starter's committed generated modules are what the generator produces today", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aponia-starter-artifacts-"));
  temporaryDirectories.push(temporaryDirectory);

  // Rendering the starter is what `aponia new` does, and it is also the only way
  // to read the committed modules: they are template sources, so the release
  // they are stamped with is the one this release substitutes for
  // `{{APONIA_VERSION}}`.
  const project = await generateProject({
    name: "starter-artifacts",
    cwd: temporaryDirectory,
    skipInstall: true,
  });
  const invokerPath = join(project.projectDirectory, "src/invokers.generated.ts");
  const descriptorPath = join(project.projectDirectory, "src/descriptors.generated.ts");
  const committed = {
    invokers: await Bun.file(invokerPath).text(),
    descriptors: await Bun.file(descriptorPath).text(),
  };

  await generateInvokers({ cwd: project.projectDirectory, dryRun: false });

  const regenerated = {
    invokers: await Bun.file(invokerPath).text(),
    descriptors: await Bun.file(descriptorPath).text(),
  };

  // The stamp is what the platform compares before it accepts the artifact at
  // all, so the committed module has to carry the release that is running.
  expect(committed.invokers).toContain(`framework: ${JSON.stringify(aponiaVersion)},`);
  expect(regenerated.invokers.replace(elysiaStamp, `  elysia: "<provenance>",`)).toBe(
    committed.invokers.replace(elysiaStamp, `  elysia: "<provenance>",`),
  );
  expect(regenerated.descriptors).toBe(committed.descriptors);
});
