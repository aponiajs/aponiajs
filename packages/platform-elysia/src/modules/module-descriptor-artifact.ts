import type { LoggerService, ModuleDefinition } from "@aponiajs/common";
import type { AponiaRootModule } from "./module-compiler.types.ts";
import type {
  AponiaModuleDescriptorArtifact,
  AponiaRootModuleSelection,
} from "./module-descriptor-artifact.types.ts";

/**
 * The root module bootstrap compiles: the artifact's declared descriptor when it
 * holds one for the module the application named, and that module itself
 * otherwise.
 *
 * An invoker artifact substitutes one handler at a time, so a refusal costs a
 * cold start and nothing else. This artifact is the whole module graph, so a
 * refusal has to be decided once, before anything is lowered: a descriptor that
 * is not accepted is not used at all, and the application names its root module
 * class either way. That is what keeps a stale, truncated, or foreign artifact
 * from ever turning a bootable application into one that cannot start — the
 * worst it can do is cost the lowering the descriptor was meant to remove.
 *
 * The lookup is by the class name the application declared, because a module
 * descriptor is keyed by the name `aponia build` read. An artifact left behind
 * after a module was renamed therefore holds no declaration for the new name and
 * is refused, which is what stops a leftover entry from booting a module the
 * application no longer declares.
 *
 * The decision travels back with the root it selected, and the stamp is the
 * artifact's own: adoption is the only case that has one, so a consumer can tell
 * a boot that served generated data from one that lowered a hand-written
 * descriptor, which no artifact ever emitted.
 *
 * @internal
 */
export function selectRootModuleDescriptor(
  artifact: AponiaModuleDescriptorArtifact | undefined,
  rootModule: AponiaRootModule,
  frameworkVersion: string,
  logger: LoggerService | undefined,
): AponiaRootModuleSelection {
  if (artifact === undefined) {
    return lowered(rootModule);
  }

  // An application that hands over a descriptor, or a dynamic module, has already
  // named the graph to boot; there is nothing left to substitute.
  if (typeof rootModule !== "function") {
    return lowered(rootModule);
  }

  const declared = readDeclaredModules(artifact, frameworkVersion, logger);
  if (declared === undefined) {
    return lowered(rootModule);
  }

  const descriptor = Object.hasOwn(declared, rootModule.name)
    ? declared[rootModule.name]
    : undefined;
  if (descriptor === undefined) {
    logger?.log(
      `The generated module descriptors hold no declaration for "${rootModule.name}", so it is lowered ` +
        "from its decorators instead. Run `aponia build` again.",
      "RoutesResolver",
    );
    return lowered(rootModule);
  }

  if (!isModuleDefinition(descriptor)) {
    logger?.log(
      `The generated module descriptors hold a declaration for "${rootModule.name}" that is not a ` +
        "module descriptor, so it is lowered from its decorators instead. Run `aponia build` again.",
      "RoutesResolver",
    );
    return lowered(rootModule);
  }

  logger?.log(
    `Booting ${rootModule.name} from the generated module descriptors, so the declared graph serves this ` +
      "application.",
    "RoutesResolver",
  );
  return Object.freeze({ rootModule: descriptor, builtBy: artifact.framework });
}

/**
 * The caller's own root, which no artifact supplied.
 *
 * A refusal and a caller-passed descriptor are the same answer here: the graph
 * being compiled is the one the application named, and there is no artifact
 * release to report for it.
 */
function lowered(rootModule: AponiaRootModule): AponiaRootModuleSelection {
  return Object.freeze({ rootModule, builtBy: null });
}

/**
 * The artifact's module record, or `undefined` when the artifact is refused.
 *
 * A hand-written or truncated artifact is refused the same way a stale one is.
 * The option is typed, but a JavaScript caller has no type checker.
 */
function readDeclaredModules(
  artifact: AponiaModuleDescriptorArtifact,
  frameworkVersion: string,
  logger: LoggerService | undefined,
): Readonly<Record<string, ModuleDefinition>> | undefined {
  if (typeof artifact !== "object" || artifact === null) {
    logger?.log(
      "The generated module descriptors carry no artifact record, so the decorated root module is lowered instead.",
      "RoutesResolver",
    );
    return undefined;
  }

  const modules: unknown = artifact.modules;
  if (typeof modules !== "object" || modules === null || Array.isArray(modules)) {
    logger?.log(
      "The generated module descriptors carry no module record, so the decorated root module is " +
        "lowered instead.",
      "RoutesResolver",
    );
    return undefined;
  }

  if (artifact.framework !== frameworkVersion) {
    logger?.log(
      `The generated module descriptors were built by AponiaJS ${artifact.framework} against ` +
        `Elysia ${artifact.elysia ?? "an unresolved version"}, but AponiaJS ${frameworkVersion} ` +
        "is running, so the decorated root module is lowered instead. Run `aponia build` again.",
      "RoutesResolver",
    );
    return undefined;
  }

  return modules as Readonly<Record<string, ModuleDefinition>>;
}

/**
 * Whether a value is the module descriptor shape the container compiles.
 *
 * The four collections and the id are all a generated declaration is read
 * through, and a JavaScript caller can hand over anything. A descriptor missing
 * one of them would otherwise reach the graph compiler and fail the boot, which
 * is the one outcome this option must never cause.
 */
function isModuleDefinition(value: unknown): value is ModuleDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Record<keyof ModuleDefinition, unknown>>;
  return (
    typeof candidate.id === "string" &&
    Array.isArray(candidate.imports) &&
    candidate.imports.every((entry) => typeof entry === "object" && entry !== null) &&
    Array.isArray(candidate.controllers) &&
    candidate.controllers.every((entry) => typeof entry === "object" && entry !== null) &&
    Array.isArray(candidate.providers) &&
    candidate.providers.every((entry) => typeof entry === "object" && entry !== null) &&
    Array.isArray(candidate.exports)
  );
}
