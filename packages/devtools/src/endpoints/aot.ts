import { dirname, join, relative, resolve, sep } from "node:path";
import type { AnalyzedController, DeclinedControllerHandler } from "@aponiajs/cli";
import type { LoggerService } from "@aponiajs/common";
import type { AponiaApplicationDiagnostics } from "@aponiajs/platform-elysia";
import { oneLine } from "../logging/one-line.ts";
import { reportFailure } from "../logging/report-failure.ts";
import { aponiaVersion } from "../version.ts";
import type { AponiaAotController, AponiaAotPayload } from "./aot.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsAotPath = "/aot";

/**
 * The framework half of the payload: the two facts a boot recorded about the
 * artifacts it was offered, validated once and frozen.
 */
export type AponiaAotFacts = Pick<AponiaAotPayload, "graph" | "invokers">;

/** What an analysis that could not be read answers with, frozen once. */
const noControllers: readonly AponiaAotController[] = Object.freeze([]);

/**
 * Every analysis this process has read, keyed by project root.
 *
 * The entry is the promise rather than its result, so two requests that arrive
 * together share one reading instead of parsing the project twice. It is also
 * settled to an empty list rather than left rejected: every later request reads
 * this map, and a rejection would be thrown again for each poll of a failure
 * that was reported once.
 */
const analyses = new Map<string, Promise<readonly AponiaAotController[]>>();

/**
 * Reads the facts `/aot` publishes out of a boot record, or `undefined` when the
 * record states none this release can report.
 *
 * The record arrives through a registry-global symbol key, so it may have been
 * written by a copy of `@aponiajs/platform-elysia` this release does not own, or
 * not written at all: an application no boot produced reads as `undefined`, and
 * one a newer copy booted can answer a graph this union does not name. Both are
 * a boot this endpoint has nothing to say about — the registration gate reads
 * this function's answer, and a `404` is the dispatcher's reply for the path
 * this surface does not serve — rather than a payload assembled from fields that
 * were only assumed to be there.
 *
 * The invoker verdict is published as the record states it, and nothing is
 * derived from it. A reason belongs to a refusal, so a record that carries none
 * publishes none: an artifact this release adopted is reported with no reason
 * key at all, rather than with a placeholder this package invented or with the
 * selector's sentence restated for a refusal that never happened.
 *
 * `/aot` degrades along two axes, and they are not the same failure. This
 * function is the first: a record that states none of these facts serves no
 * `/aot` at all, because there is nothing to publish rather than something lost
 * — the path is not one this surface owns, and every other endpoint it serves,
 * `/meta` included, answers exactly as it did. The second is the analysis: a
 * record this release can read, a project it cannot, and the endpoint still
 * answers with the boot's half and an empty controller list. An absent fact is
 * reported where it is absent; a degraded half is reported under `Devtools`.
 */
export function readAotFacts(
  diagnostics: AponiaApplicationDiagnostics | undefined,
): AponiaAotFacts | undefined {
  const graph = diagnostics?.graph;
  const invokers = diagnostics?.invokers;
  const reason = invokers?.reason;

  if (
    (graph !== "declared" && graph !== "decorated") ||
    typeof invokers?.accepted !== "boolean" ||
    (reason !== undefined && typeof reason !== "string")
  ) {
    return undefined;
  }

  return Object.freeze({
    graph,
    invokers: Object.freeze({ accepted: invokers.accepted, reason }),
  });
}

/**
 * The payload one request answers with: the facts this surface reads from the
 * record, beside the verdicts that request settled.
 *
 * The build-time verdicts behind a boot: what a build's analysis would decide
 * about this project's controllers, beside what this boot decided about the
 * artifacts a build produces. The two halves have different owners and fail
 * differently, which is why the endpoint answers both in one payload. The boot's
 * facts are already recorded when the surface first answers, so they are served whether
 * or not a project is on disk and whether or not the analysis loaded. The
 * per-handler verdicts come from `@aponiajs/cli`, which is imported on the first
 * request to this endpoint and never at boot: it carries `ts-morph` and a
 * formatter, and an application that never polls this endpoint should not pay for
 * either. A project the analysis cannot read degrades that half — the controller
 * list stays empty and the reason is reported once under `Devtools` — rather than
 * failing the endpoint that states the boot's own facts.
 *
 * The half that is read once and the half that is awaited per request meet
 * here, and neither is copied from the other: `controllers` is the analysis's
 * own frozen array, and the facts are the frozen pair the registration gate
 * already validated, so a response cannot report one of them differently from
 * the response before it.
 *
 * The analysis is a copy of the build's rules, not a second implementation with
 * its own opinions: `analyzeControllers` mirrors `generateInvokers` in
 * `packages/cli/src/generation/invoker-generator.ts`, and the per-handler
 * verdicts are read off the emitter's own returned declines rather than
 * re-applied here, so a reason reported by this endpoint is the sentence the
 * build prints. The two copies are kept in step by hand.
 */
export function buildAotPayload(
  facts: AponiaAotFacts,
  controllers: readonly AponiaAotController[],
): AponiaAotPayload {
  return Object.freeze({
    graph: facts.graph,
    invokers: facts.invokers,
    controllers,
  });
}

/**
 * The per-handler verdicts for one project root, read at most once per process.
 *
 * The project root is the process's own working directory, which is the root
 * `aponia build` defaults to, and it is read by the caller when the request
 * arrives rather than when the application starts: an application started from
 * anywhere else reports the project it was actually started in.
 *
 * A failed analysis is cached like a successful one. The row it writes is one
 * row per project per process — the point of caching the promise — because a
 * devtools client polls, and a reader who has seen the reason once does not need
 * it again on every request. A project fixed on disk is therefore reported as
 * unreadable until the process restarts, which is the price of not walking a
 * project's source on every poll; `bun --watch` restarts the process and clears
 * it.
 */
export function loadAotAnalysis(
  projectRoot: string,
  logger: LoggerService,
): Promise<readonly AponiaAotController[]> {
  const loaded = analyses.get(projectRoot);

  if (loaded !== undefined) {
    return loaded;
  }

  const loading = analyzeProject(projectRoot, logger);
  analyses.set(projectRoot, loading);

  return loading;
}

/**
 * One project's verdicts, or no verdicts at all when they cannot be read.
 *
 * This is the one place `@aponiajs/cli` is reached, and it is reached
 * dynamically. The import is inside the `try` with the analysis because the two
 * fail the same way from here — a release whose built entry is not installed, a
 * module that throws while loading, a project with no configuration to read —
 * and all of them degrade this endpoint's second half rather than the endpoint.
 *
 * The report is guarded, because it and the degraded half are two halves of one
 * promise: a logger that refuses the row would otherwise reject the promise this
 * module caches, and the endpoint would answer a failure instead of the payload
 * `/aot` promises — for the life of the process, since a rejection is cached
 * like a result. The row is a report of a failure, so it is guarded by the rule
 * the framework states; nothing between the analysis and the `return` below
 * escapes this `catch`, the sentence included, because the value it states is
 * read by a `oneLine` that cannot throw — a value that refuses to be read is
 * stated as `[unrenderable]` rather than left out. See
 * `logging/report-failure.ts`.
 */
async function analyzeProject(
  projectRoot: string,
  logger: LoggerService,
): Promise<readonly AponiaAotController[]> {
  try {
    return await analyzeControllers(projectRoot);
  } catch (error) {
    reportFailure(
      logger,
      `Aponia devtools could not read the route analysis of "${projectRoot}" (${oneLine(error)}); /aot answers the boot's record alone.`,
    );

    return noControllers;
  }
}

/**
 * One project's verdicts, as the build's own analysis reports them.
 *
 * This mirrors `generateInvokers` rather than calling it. That command writes
 * the generated modules and refuses a project it cannot build, while this
 * endpoint only reports what a build would decide, so each rule is repeated here
 * from `generation/invoker-generator.ts` and `generation/project-configuration.ts`:
 * the configuration file, the source root and its escape guard, the ignore list,
 * the sorted walk, the duplicate class name, and the import specifier. The walk
 * itself is `Bun.Glob` rather than the `fast-glob` the command uses, because a
 * runtime package reaches its glob through the runtime and does not take a
 * dependency on one; the patterns, the order, and the files they leave out are
 * the same.
 *
 * The default project is the one mirrored, because `/aot` has no way to name
 * another: `aponia.json` is read the way a build with no `--project` reads it.
 * The refusal sentences are the command's own words, and `tests/aot.test.ts`
 * reads them back out of `generateInvokers` rather than copying them into the
 * case, so a wording change on either side fails there instead of shipping. The
 * two rules no sentence states — the source root and the ignore list — are read
 * at both ends the same way: a case compares this endpoint's verdict for a
 * project whose ignored files hold a controller double against the command's own
 * decision for that project, so one side changing a rule alone fails there
 * rather than reporting verdicts over a different file set than a build reads.
 *
 * The emitter decides and this reports. Which handler is emitted and which is
 * declined comes from `emitControllerInvokers`, and the verdicts are read off
 * the declines it returned rather than re-applied here, so the reason beside a
 * compiled handler is the sentence the build itself prints. The module it
 * renders is discarded: this endpoint states the verdicts, not the source they
 * would be written into.
 */
async function analyzeControllers(projectRoot: string): Promise<readonly AponiaAotController[]> {
  const {
    analyzeControllerRoutes,
    descriptorModuleFileName,
    emitControllerInvokers,
    invokerModuleFileName,
  } = await import("@aponiajs/cli");
  const sourceRoot = await resolveSourceRoot(projectRoot);
  const outputPath = join(sourceRoot, invokerModuleFileName);
  const files = await listSourceFiles(sourceRoot, [
    invokerModuleFileName,
    descriptorModuleFileName,
  ]);
  const found: { readonly controller: AnalyzedController; readonly file: string }[] = [];

  for (const file of files) {
    const source = await Bun.file(file).text();
    for (const controller of analyzeControllerRoutes(source, file)) {
      found.push({ controller, file });
    }
  }

  if (found.length === 0) {
    // The build's own refusal, sentence and all: a project with no controller is
    // one a build fails on, and the empty list this endpoint answers with is
    // then "no verdicts exist" rather than "no controllers were read".
    throw new Error(
      `No class decorated with @Controller() was found under "${relative(projectRoot, sourceRoot)}".`,
    );
  }

  const specifiers: Record<string, string> = {};
  for (const { controller, file } of found) {
    if (specifiers[controller.className] !== undefined) {
      // The command's own sentence, word for word: a developer reads one
      // explanation for one condition, and the case that pins it asks
      // `generateInvokers` what it says rather than repeating it here.
      // The generated module imports each class by name, so two classes sharing
      // one name cannot both be addressed and the build refuses the whole
      // project. The same refusal is what makes a per-handler verdict
      // unreachable for either of them.
      throw new Error(
        `Two controllers are named "${controller.className}". Rename one; a generated ` +
          `invoker module imports each controller by its class name.`,
      );
    }

    specifiers[controller.className] = toImportPath(outputPath, file);
  }

  const provenance = Object.freeze({ framework: aponiaVersion, elysia: null });
  const emitted = emitControllerInvokers(
    found.map((entry) => entry.controller),
    specifiers,
    provenance,
  );

  return projectControllers(found, emitted.declined);
}

/**
 * The wire verdicts for each controller, with the emitter's declines joined back
 * onto the handlers they describe.
 *
 * `declined` is the emitter's own list, keyed by controller and method, and
 * everything it does not name was emitted: a handler's verdict is the presence
 * of a reason rather than a second reading of the rule that produces one. The
 * provenance passed to the emitter stamps a module this endpoint throws away —
 * the release it names is this one, whichever artifact a build would write.
 */
function projectControllers(
  found: readonly { readonly controller: AnalyzedController; readonly file: string }[],
  declined: readonly DeclinedControllerHandler[],
): readonly AponiaAotController[] {
  const reasons = new Map<string, string>();
  for (const entry of declined) {
    reasons.set(`${entry.controller}.${entry.method}`, entry.reason);
  }

  return Object.freeze(
    found.map(({ controller }) =>
      Object.freeze({
        controller: controller.className,
        handlers: Object.freeze(
          handlerNames(controller).map((handler) => {
            const reason = reasons.get(`${controller.className}.${handler}`);

            return Object.freeze({
              handler,
              invoker: reason === undefined ? ("generated" as const) : ("compiled" as const),
              reason,
            });
          }),
        ),
      }),
    ),
  );
}

/**
 * A controller's handlers, in the order the emitter visits them.
 *
 * The emitter keys its invokers by the handler's property key, not by route: a
 * method carrying two route decorators is one handler with one verdict, declared
 * in the position of the first route the source declared it on. That rule is
 * repeated here because it is the shape of the key the two emitters meet on
 * (`packages/cli/src/generation/controller-invokers.ts`), and it is the only
 * part of an emitter's output this endpoint cannot read back.
 */
function handlerNames(controller: AnalyzedController): readonly string[] {
  const names: string[] = [];

  for (const route of controller.routes) {
    if (!names.includes(route.methodName)) {
      names.push(route.methodName);
    }
  }

  return names;
}

/**
 * The source root a project configures, refusing one that leaves the project.
 *
 * A copy of `resolveSourceRoot`'s two rules in
 * `packages/cli/src/generation/project-configuration.ts` — the configuration
 * file's absence and the escape guard — sentences included, so the row a
 * developer reads here names what `aponia build` would say about the same
 * project.
 */
async function resolveSourceRoot(projectRoot: string): Promise<string> {
  const file = Bun.file(join(projectRoot, "aponia.json"));

  if (!(await file.exists())) {
    throw new Error('Could not find "aponia.json". Run the command from an Aponia project root.');
  }

  const configuration = (await file.json()) as { readonly sourceRoot?: string };
  const sourceRoot = resolve(projectRoot, configuration.sourceRoot ?? "src");

  if (sourceRoot !== projectRoot && !sourceRoot.startsWith(`${projectRoot}${sep}`)) {
    throw new Error(`Path "${configuration.sourceRoot}" escapes the project root.`);
  }

  return sourceRoot;
}

/**
 * Every source file a build reads under the source root, sorted by path.
 *
 * The ignore list is the build's: a test file declares nothing a build mounts,
 * and the two generated modules are build outputs rather than project source.
 * The walk follows directory symlinks, which is what the command's glob does by
 * default, so a project laid out through links is read the way a build reads it.
 */
async function listSourceFiles(
  sourceRoot: string,
  generatedModules: readonly string[],
): Promise<readonly string[]> {
  const ignored = [
    "**/*.spec.ts",
    "**/*.test.ts",
    ...generatedModules.map((name) => `**/${name}`),
  ].map((pattern) => new Bun.Glob(pattern));

  const files = await Array.fromAsync(
    new Bun.Glob("**/*.ts").scan({
      cwd: sourceRoot,
      absolute: true,
      onlyFiles: true,
      followSymlinks: true,
    }),
  );

  return files
    .filter((file) => {
      const path = relative(sourceRoot, file).replaceAll("\\", "/");

      return !ignored.some((pattern) => pattern.match(path));
    })
    .toSorted();
}

/**
 * The specifier a generated module in `outputPath` reaches one source file by.
 *
 * The module this endpoint would write is discarded, so nothing reads these
 * paths. They are still resolved the way the build resolves them rather than
 * passed as placeholders: the emitter refuses to generate for a controller it
 * has no specifier for, so a placeholder would move a handler's verdict away
 * from the one a build reaches.
 */
function toImportPath(outputPath: string, sourceFile: string): string {
  const path = relative(dirname(outputPath), sourceFile).replaceAll("\\", "/");

  return path.startsWith(".") ? path : `./${path}`;
}
