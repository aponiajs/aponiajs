import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

const repositoryRoot = resolve(import.meta.dir, "..");

/**
 * The authoring surface `@aponiajs/cli` repeats by hand.
 *
 * `@aponiajs/cli` deliberately does not depend on the runtime packages, so its
 * build-time analysis restates what `@aponiajs/common` owns: decorator names,
 * minor unions, and the metadata keys those decorators write. Hand-copied
 * surface drifts, and the drift is silent in the direction that matters —
 * `@UseGuards()`, `@UseInterceptors()`, and `@UseFilters()` were once dropped
 * from the descriptor artifact `aponia build` writes, so an application that
 * declared a guard booted from that artifact **unguarded**, with no `DECLINED`
 * line and no warning. An extra declaration fails loudly; a missing one does
 * not.
 *
 * This guard reads the runtime surface out of `packages/common`'s own source
 * text, and the two platform-owned artifact shapes the CLI restates out of
 * `packages/platform-elysia`'s, and fails when the CLI's analysis no longer
 * accounts for either. Nothing here imports any package: the CLI lane cannot
 * import the runtime packages, and a guard that imported them would prove only
 * that today's two copies agree, not that a person adding the next decorator,
 * metadata key, union member, or artifact field would be told to update the
 * CLI.
 *
 * What this guard does not cover, stated rather than implied:
 *
 * - It is a source-text read. A decorator built dynamically, exported from
 *   another module and re-exported by `packages/common/src/index.ts`, or
 *   declared with a return type that never names a `*Decorator` type is
 *   invisible to it. Adding such a decorator to `packages/common` needs the
 *   reader extended as well; the floor and the required-entry lists below fail
 *   if that silently stops matching, but they cannot see the new name.
 * - It reads two platform-owned artifact shapes — `AponiaInvokerArtifact` and
 *   `AponiaModuleDescriptorArtifact` — and nothing else from
 *   `packages/platform-elysia`. Every other platform-owned body `aponia build`
 *   restates by hand stays outside it: the `defineModule` field names, the
 *   `defineControllerRoutes` route fields (`method`, `path`, `handler`,
 *   `schema`, and the enhancer lists), the `defineWebSocketGateway` plan
 *   fields, and the `ControllerHandlerFactory`/`RouteHandler` shapes the
 *   invoker map is written against.
 * - It compares names and union members, not meaning. A decorator whose
 *   argument shape the CLI reads differently from the runtime is not caught,
 *   and neither is a field whose type changed while its name stayed — `elysia`
 *   widening from `string | null` to `string` would pass.
 * - `AnalyzedTokenKind` is a string union with no string-union runtime
 *   counterpart: the runtime states its token forms structurally, as
 *   `Token<T> = ClassToken<T> | InjectionToken<T>`. The correspondence table
 *   below is what covers it — member identity in both directions, failing when
 *   either side gains a member the other does not account for. The
 *   correspondence itself, which CLI member stands for which runtime member, is
 *   this guard's stated claim rather than something the sources say, so a
 *   rename on both sides at once is not caught.
 */
const runtimeSourceRoot = "packages/common/src";
const controllerRoutesFile = "packages/cli/src/generation/controller-routes.ts";
const controllerRoutesTypesFile = "packages/cli/src/generation/controller-routes.types.ts";
const invokerArtifactTypesFile = "packages/platform-elysia/src/routing/invoker-artifact.types.ts";
const moduleDescriptorArtifactTypesFile =
  "packages/platform-elysia/src/modules/module-descriptor-artifact.types.ts";
const controllerInvokersFile = "packages/cli/src/generation/controller-invokers.ts";
const controllerInvokersTypesFile = "packages/cli/src/generation/controller-invokers.types.ts";
const descriptorEmitterFile = "packages/cli/src/generation/descriptor-emitter.ts";
const moduleDescriptorsFile = "packages/cli/src/generation/module-descriptors.ts";
const moduleDescriptorsTypesFile = "packages/cli/src/generation/module-descriptors.types.ts";
const tokenTypesFile = "packages/common/src/tokens/token.types.ts";

/**
 * A `*Decorator` return type is what makes an export a decorator factory rather
 * than a value the runtime reads with: every getter in `packages/common`
 * returns a `*Metadata` type or a token list, and no other export in the
 * package declares one of these annotations.
 */
const decoratorTypePattern = /\b\w*Decorator(?:Factory)?\b/;

/**
 * The decorator factories a source file exports.
 *
 * Two shapes carry one, and both are read here: an exported function whose
 * declared return type names a `*Decorator` type, and an exported `const`
 * bound to a call of a helper the same file declares — how
 * `export const Get = createRouteDecorator("GET")` and
 * `export const Body = createParameterDecorator("body")` are written.
 *
 * The helper's evidence is its own declaration text, because
 * `createParameterDecorator` annotates the arrow it returns rather than its own
 * signature.
 */
function readDecoratorFactories(content: string): readonly string[] {
  const lines = content.split("\n");
  const factories = new Set<string>();

  // Overload signatures and the implementation sit above one another under one
  // name, so the set collapses them.
  for (const match of content.matchAll(
    /^export function (\w+)\s*\([\s\S]*?\)\s*:\s*([^;{}\n]+)[;{]/gm,
  )) {
    if (decoratorTypePattern.test(match[2]!)) {
      factories.add(match[1]!);
    }
  }

  for (const match of content.matchAll(/^export const (\w+) = (\w+)\(/gm)) {
    if (declaresDecoratorReturn(lines, match[2]!)) {
      factories.add(match[1]!);
    }
  }

  return Object.freeze([...factories].sort());
}

/**
 * Whether the function a file declares under `name` returns a decorator, read
 * from its signature or, when that carries no annotation, from the arrow it
 * returns.
 *
 * The body is bounded by the first line that is a lone closing brace, which is
 * how the repository's formatter lays a top-level function out.
 */
function declaresDecoratorReturn(lines: readonly string[], name: string): boolean {
  const start = lines.findIndex((line) =>
    new RegExp(`^(?:export )?function ${name}\\(`).test(line),
  );
  if (start === -1) {
    return false;
  }

  const declaration: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && lines[index] === "}") {
      break;
    }

    declaration.push(lines[index] ?? "");
  }

  return decoratorTypePattern.test(declaration.join("\n"));
}

/** The `a.b.c` keys a source file builds with `Symbol.for(...)`. */
function readMetadataKeys(content: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of content.matchAll(/Symbol\.for\(\s*"(aponia\.[^"]+)"\s*,?\s*\)/g)) {
    keys.add(match[1]!);
  }

  return Object.freeze([...keys].sort());
}

/** The members of `export type Name = "a" | "b";`. */
function readStringUnion(content: string, name: string): readonly string[] {
  const match = new RegExp(`^export type ${name} =\\s*([\\s\\S]*?);`, "m").exec(content);
  if (match === null) {
    throw new Error(`No exported type named ${name} in the file the guard read.`);
  }

  return Object.freeze([...match[1]!.matchAll(/"([^"]*)"/g)].map((literal) => literal[1]!));
}

/**
 * The member names of `export type Name<T> = A<T> | B<T>;`.
 *
 * A structural union carries no string literal to read, so each member is taken
 * as the identifier it is written with. Only the leading identifier of a member
 * is read: the type arguments a member applies are its declaration, not a
 * second member.
 */
function readTypeAliasUnionMembers(content: string, name: string): readonly string[] {
  const match = new RegExp(`^export type ${name}(?:<[^>]*>)? =\\s*([\\s\\S]*?);`, "m").exec(
    content,
  );
  if (match === null) {
    throw new Error(`No exported type named ${name} in the file the guard read.`);
  }

  const members = match[1]!
    .split("|")
    .map((part) => /^\s*(\w+)/.exec(part)?.[1])
    .filter((member): member is string => member !== undefined);

  return Object.freeze(members);
}

/** The members of `const Name = ["a", "b"] as const;`, in declaration order. */
function readStringArrayConstant(content: string, name: string): readonly string[] {
  const match = new RegExp(
    `^(?:export )?const ${name}(?::[^=]*)? = \\[([\\s\\S]*?)\\]\\s*(?:as const)?;`,
    "m",
  ).exec(content);
  if (match === null) {
    throw new Error(`No constant array named ${name} in the file the guard read.`);
  }

  return Object.freeze([...match[1]!.matchAll(/"([^"]*)"/g)].map((literal) => literal[1]!));
}

/** The value of `const Name = "value";`. */
function readStringConstant(content: string, name: string): string {
  const match = new RegExp(`^(?:export )?const ${name}(?::[^=]*)? = "([^"]*)";`, "m").exec(content);
  if (match === null) {
    throw new Error(`No string constant named ${name} in the file the guard read.`);
  }

  return match[1]!;
}

/** The property names of `export interface Name { ... }`. */
function readInterfacePropertyNames(content: string, name: string): readonly string[] {
  const match = new RegExp(`^export interface ${name} \\{([\\s\\S]*?)\\n\\}`, "m").exec(content);
  if (match === null) {
    throw new Error(`No exported interface named ${name} in the file the guard read.`);
  }

  return Object.freeze([...match[1]!.matchAll(/readonly (\w+)\??:/g)].map((entry) => entry[1]!));
}

/**
 * The keys of `const Name: ... = new Map([["key", "value"], ...]);`, in
 * declaration order.
 */
function readMapEntries(content: string, name: string): readonly (readonly [string, string])[] {
  const match = new RegExp(`^const ${name}[^=]*= new Map\\(\\[([\\s\\S]*?)\\]\\);`, "m").exec(
    content,
  );
  if (match === null) {
    throw new Error(`No map named ${name} in the file the guard read.`);
  }

  const entries = [...match[1]!.matchAll(/\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,?\s*\]/g)];
  return Object.freeze(entries.map((entry) => Object.freeze([entry[1]!, entry[2]!] as const)));
}

/**
 * The own property names of an artifact object literal an emitter writes.
 *
 * The emitter composes the record from template strings rather than from data,
 * so its field names exist only in the source that writes them. The literal is
 * introduced by the `Object.freeze({` line that names the artifact constant, and
 * its own keys sit two spaces in from that line while a nested record sits
 * deeper; reading the block between them, and only the keys at its own depth, is
 * what makes this the artifact's surface rather than every key beneath it.
 */
function readEmittedArtifactKeys(content: string, exportName: string): readonly string[] {
  const lines = content.split("\n");
  const start = lines.findIndex(
    (line) => line.includes(exportName) && line.includes("Object.freeze({"),
  );
  if (start === -1) {
    throw new Error(`No emitted artifact named ${exportName} in the file the guard read.`);
  }

  const keys = new Set<string>();
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.includes("});")) {
      break;
    }

    const key = /^[`"]\s{2}(\w+):/.exec(line.trimStart())?.[1];
    if (key !== undefined) {
      keys.add(key);
    }
  }

  if (keys.size === 0) {
    throw new Error(`The emitted artifact ${exportName} declares no fields the guard read.`);
  }

  return Object.freeze([...keys].sort());
}

/** How a CLI analysis file states the names it recognises. */
interface CliReading {
  /** Repository-relative path of the CLI file. */
  readonly file: string;
  /** A string constant, or the keys of a `new Map([...])`. */
  readonly kind: "string-constant" | "map-keys";
  /** The declaration's name. */
  readonly name: string;
}

/**
 * Where each runtime name must be recognised, keyed by the analysis the guard
 * reports it under. A consumer with more than one reading is one whose rule a
 * generated module needs in more than one place.
 */
const cliAnalyses: ReadonlyMap<string, readonly CliReading[]> = new Map([
  [
    "controller-routes.ts's @Controller",
    [
      { file: controllerRoutesFile, kind: "string-constant", name: "controllerDecoratorName" },
      {
        file: moduleDescriptorsFile,
        kind: "string-constant",
        name: "controllerDecoratorName",
      },
    ],
  ],
  [
    "controller-routes.ts's requestMethodDecorators",
    [{ file: controllerRoutesFile, kind: "map-keys", name: "requestMethodDecorators" }],
  ],
  [
    "controller-routes.ts's parameterDecorators",
    [{ file: controllerRoutesFile, kind: "map-keys", name: "parameterDecorators" }],
  ],
  [
    "controller-routes.ts's enhancerDecorators",
    [{ file: controllerRoutesFile, kind: "map-keys", name: "enhancerDecorators" }],
  ],
  [
    "module-descriptors.ts's @Module",
    [{ file: moduleDescriptorsFile, kind: "string-constant", name: "moduleDecoratorName" }],
  ],
  [
    "module-descriptors.ts's @Injectable",
    [{ file: moduleDescriptorsFile, kind: "string-constant", name: "injectableDecoratorName" }],
  ],
  [
    "module-descriptors.ts's @Inject",
    [{ file: moduleDescriptorsFile, kind: "string-constant", name: "injectDecoratorName" }],
  ],
  [
    "module-descriptors.ts's @Validation",
    [{ file: moduleDescriptorsFile, kind: "string-constant", name: "validationDecoratorName" }],
  ],
  [
    "module-descriptors.ts's @WebSocketGateway",
    [{ file: moduleDescriptorsFile, kind: "string-constant", name: "gatewayDecoratorName" }],
  ],
  [
    "module-descriptors.ts's @SubscribeMessage",
    [
      {
        file: moduleDescriptorsFile,
        kind: "string-constant",
        name: "subscribeMessageDecoratorName",
      },
    ],
  ],
  [
    "module-descriptors.ts's gateway parameter decorators",
    [
      { file: moduleDescriptorsFile, kind: "string-constant", name: "messageBodyDecoratorName" },
      {
        file: moduleDescriptorsFile,
        kind: "string-constant",
        name: "connectedSocketDecoratorName",
      },
    ],
  ],
  [
    "module-descriptors.ts's @WebSocketServer",
    [
      {
        file: moduleDescriptorsFile,
        kind: "string-constant",
        name: "webSocketServerDecoratorName",
      },
    ],
  ],
  [
    "module-descriptors.ts's @Global",
    [
      {
        file: moduleDescriptorsFile,
        kind: "string-constant",
        name: "globalDecoratorName",
      },
    ],
  ],
]);

/** The analysis that must recognise each decorator `packages/common` exports. */
const decoratorAnalyses: ReadonlyMap<string, string> = new Map([
  ["Controller", "controller-routes.ts's @Controller"],
  ["Delete", "controller-routes.ts's requestMethodDecorators"],
  ["Get", "controller-routes.ts's requestMethodDecorators"],
  ["Head", "controller-routes.ts's requestMethodDecorators"],
  ["Options", "controller-routes.ts's requestMethodDecorators"],
  ["Patch", "controller-routes.ts's requestMethodDecorators"],
  ["Post", "controller-routes.ts's requestMethodDecorators"],
  ["Put", "controller-routes.ts's requestMethodDecorators"],
  ["Body", "controller-routes.ts's parameterDecorators"],
  ["Cookie", "controller-routes.ts's parameterDecorators"],
  ["Context", "controller-routes.ts's parameterDecorators"],
  ["Headers", "controller-routes.ts's parameterDecorators"],
  ["HttpStatus", "controller-routes.ts's parameterDecorators"],
  ["Param", "controller-routes.ts's parameterDecorators"],
  ["Query", "controller-routes.ts's parameterDecorators"],
  ["Req", "controller-routes.ts's parameterDecorators"],
  ["ResponseSettings", "controller-routes.ts's parameterDecorators"],
  ["State", "controller-routes.ts's parameterDecorators"],
  ["UseFilters", "controller-routes.ts's enhancerDecorators"],
  ["UseGuards", "controller-routes.ts's enhancerDecorators"],
  ["UseInterceptors", "controller-routes.ts's enhancerDecorators"],
  ["Module", "module-descriptors.ts's @Module"],
  ["Global", "module-descriptors.ts's @Global"],
  ["Injectable", "module-descriptors.ts's @Injectable"],
  ["Inject", "module-descriptors.ts's @Inject"],
  ["Validation", "module-descriptors.ts's @Validation"],
  ["WebSocketGateway", "module-descriptors.ts's @WebSocketGateway"],
  ["SubscribeMessage", "module-descriptors.ts's @SubscribeMessage"],
  ["MessageBody", "module-descriptors.ts's gateway parameter decorators"],
  ["ConnectedSocket", "module-descriptors.ts's gateway parameter decorators"],
  ["WebSocketServer", "module-descriptors.ts's @WebSocketServer"],
]);

/**
 * The decorators `packages/common` exports that no CLI analysis reads, and why
 * each is safe.
 *
 * `@Catch()` decorates the filter class itself, and the CLI lowers a filter as
 * an imported class reference rather than as data: the decorator runs when that
 * class's own module loads, so nothing about it has to be restated in the
 * generated module. Every other decorator here decorates a declaration the CLI
 * writes out itself, which is what puts it in the tables above.
 */
const unreadDecorators: ReadonlyMap<string, string> = new Map([
  ["Catch", "a filter class is imported by reference, so its own decorator runs when it loads"],
]);

/** The analysis that must account for each metadata key `packages/common` reads. */
const metadataKeyAnalyses: ReadonlyMap<string, string> = new Map([
  ["aponia.controller.metadata", "controller-routes.ts's @Controller"],
  ["aponia.module.metadata", "module-descriptors.ts's @Module"],
  ["aponia.global.metadata", "module-descriptors.ts's @Global"],
  ["aponia.route.metadata", "controller-routes.ts's requestMethodDecorators"],
  ["aponia.route-parameters.metadata", "controller-routes.ts's parameterDecorators"],
  ["aponia.injected-tokens.metadata", "module-descriptors.ts's @Inject"],
  ["aponia.validation.metadata", "module-descriptors.ts's @Validation"],
  ["aponia.enhancer-class.metadata", "controller-routes.ts's enhancerDecorators"],
  ["aponia.enhancer-method.metadata", "controller-routes.ts's enhancerDecorators"],
  ["aponia.websocket-gateway.metadata", "module-descriptors.ts's @WebSocketGateway"],
  ["aponia.websocket-message.metadata", "module-descriptors.ts's @SubscribeMessage"],
  ["aponia.websocket-parameters.metadata", "module-descriptors.ts's gateway parameter decorators"],
  ["aponia.websocket-server-properties.metadata", "module-descriptors.ts's @WebSocketServer"],
]);

/** The keys `packages/common` writes that no CLI analysis reads, and why. */
const unreadMetadataKeys: ReadonlyMap<string, string> = new Map([
  [
    "aponia.enhancer-catch.metadata",
    "a filter class is imported by reference, so its own decorator runs when it loads",
  ],
  [
    "aponia.forward-ref",
    "forward references are resolved at graph compilation time in the runtime",
  ],
  [
    "aponia.injectable.metadata",
    "injectable scope metadata is read during runtime module compilation",
  ],
]);

/** How a runtime declaration is read. */
type RuntimeReading = "string-union" | "string-array" | "interface-properties";

/** One union the CLI restates instead of importing. */
interface RepeatedUnion {
  readonly runtimeFile: string;
  readonly runtimeName: string;
  readonly runtimeReading: RuntimeReading;
  readonly cliFile: string;
  readonly cliName: string;
  readonly cliReading: "string-union" | "string-array";
  /**
   * Whether the runtime states the members in an order the CLI must repeat, not
   * merely in a set it must cover.
   */
  readonly ordered: boolean;
}

const repeatedUnions: readonly RepeatedUnion[] = [
  {
    runtimeFile: "packages/common/src/decorators/decorators.types.ts",
    runtimeName: "RequestMethod",
    runtimeReading: "string-union",
    cliFile: controllerRoutesTypesFile,
    cliName: "AnalyzedRequestMethod",
    cliReading: "string-union",
    ordered: false,
  },
  {
    runtimeFile: "packages/common/src/websockets/websocket-gateway.types.ts",
    runtimeName: "WebSocketParameterKind",
    runtimeReading: "string-union",
    cliFile: moduleDescriptorsTypesFile,
    cliName: "AnalyzedWebSocketParameterKind",
    cliReading: "string-union",
    ordered: false,
  },
  {
    runtimeFile: "packages/common/src/routing/route-parameters.ts",
    runtimeName: "routeParameterKinds",
    runtimeReading: "string-array",
    cliFile: controllerRoutesTypesFile,
    cliName: "AnalyzedRouteParameterKind",
    cliReading: "string-union",
    ordered: false,
  },
  {
    runtimeFile: "packages/common/src/routing/route-schema.ts",
    runtimeName: "routeSchemaSlots",
    runtimeReading: "string-array",
    cliFile: controllerRoutesTypesFile,
    cliName: "AnalyzedRouteSchemaSlotName",
    cliReading: "string-union",
    ordered: false,
  },
  {
    // A second CLI copy of the same runtime declaration: the analysis reads
    // slots in the runtime's order, not the order the decorator wrote them in.
    runtimeFile: "packages/common/src/routing/route-schema.ts",
    runtimeName: "routeSchemaSlots",
    runtimeReading: "string-array",
    cliFile: controllerRoutesFile,
    cliName: "routeSchemaSlotNames",
    cliReading: "string-array",
    ordered: true,
  },
  {
    runtimeFile: "packages/common/src/enhancers/enhancer-decorators.types.ts",
    runtimeName: "EnhancerMetadata",
    runtimeReading: "interface-properties",
    cliFile: controllerRoutesTypesFile,
    cliName: "AnalyzedEnhancerKind",
    cliReading: "string-union",
    ordered: false,
  },
];

/** How a CLI surface states the fields of an artifact the platform consumes. */
type CliArtifactReading =
  | { readonly kind: "interface"; readonly name: string }
  | { readonly kind: "emitted-literal"; readonly exportName: string };

/**
 * One platform-owned artifact shape `aponia build` restates by hand.
 *
 * The invoker artifact is restated twice: as the `ControllerInvokerProvenance`
 * interface the emitter takes its provenance through, and as the
 * `controllerInvokerArtifact` object the emitter writes. The descriptor
 * artifact is restated only as the object literal the descriptor emitter
 * writes, because no CLI type names it.
 */
interface PlatformArtifactFieldPair {
  /** Repository-relative path of the platform file that declares the interface. */
  readonly platformFile: string;
  /** The platform interface a consumer reads the artifact through. */
  readonly platformInterface: string;
  /** Repository-relative path of the CLI file that restates the shape. */
  readonly cliFile: string;
  /** The CLI surface, named for the failure message. */
  readonly description: string;
  readonly cliReading: CliArtifactReading;
  /**
   * Fields legitimately present on the platform side and absent from the CLI
   * reading, keyed by field, with the reason each need not be restated.
   */
  readonly platformOnly: ReadonlyMap<string, string>;
}

const platformArtifactPairs: readonly PlatformArtifactFieldPair[] = [
  {
    platformFile: invokerArtifactTypesFile,
    platformInterface: "AponiaInvokerArtifact",
    cliFile: controllerInvokersTypesFile,
    description: "ControllerInvokerProvenance",
    cliReading: { kind: "interface", name: "ControllerInvokerProvenance" },
    platformOnly: new Map([
      [
        "invokers",
        "the emitter builds the invoker map from the controllers it emitted; the interface names only the provenance it is handed",
      ],
    ]),
  },
  {
    // The interface is the provenance half; the emitter writes the artifact the
    // platform actually consumes, so the invoker map it adds is checked here.
    platformFile: invokerArtifactTypesFile,
    platformInterface: "AponiaInvokerArtifact",
    cliFile: controllerInvokersFile,
    description: "the emitted controllerInvokerArtifact",
    cliReading: { kind: "emitted-literal", exportName: "controllerInvokerArtifact" },
    platformOnly: new Map(),
  },
  {
    platformFile: moduleDescriptorArtifactTypesFile,
    platformInterface: "AponiaModuleDescriptorArtifact",
    cliFile: descriptorEmitterFile,
    description: "the emitted moduleDescriptorArtifact",
    cliReading: { kind: "emitted-literal", exportName: "moduleDescriptorArtifact" },
    platformOnly: new Map(),
  },
];

/**
 * The runtime's token forms, as the structural `Token<T>` union states them, and
 * the `AnalyzedTokenKind` member each corresponds to.
 *
 * `AnalyzedTokenKind` restates a distinction the runtime draws structurally: a
 * class token is referenced by name and an `InjectionToken` is built by
 * `createToken(...)`. Neither side states the other's member names, so the
 * correspondence is this guard's own claim; it is what turns "the same number of
 * members" into "every member on each side is accounted for".
 */
interface TokenFormCorrespondence {
  readonly runtimeMember: string;
  readonly cliMember: string;
}

const tokenFormCorrespondence: readonly TokenFormCorrespondence[] = [
  { runtimeMember: "ClassToken", cliMember: "reference" },
  { runtimeMember: "InjectionToken", cliMember: "injection-token" },
];

/**
 * A floor under the platform-artifact table, so a pair removed from it cannot
 * pass by comparing nothing. The three pairs today are the invoker provenance
 * type, the invoker artifact the emitter writes, and the descriptor artifact
 * the descriptor emitter writes.
 */
const minimumPlatformArtifactPairs = 3;

/** The platform artifact type modules the table must read. */
const requiredPlatformArtifactFiles: readonly string[] = [
  invokerArtifactTypesFile,
  moduleDescriptorArtifactTypesFile,
];

/**
 * Fields the platform artifacts must still state, one from each pair's shape:
 * the shared provenance, the invoker map, and the module record.
 */
const requiredPlatformArtifactFields: readonly string[] = [
  "elysia",
  "framework",
  "invokers",
  "modules",
];

/**
 * A floor under the runtime token-form union, so a reader that stopped matching
 * cannot pass by finding none.
 */
const minimumRuntimeTokenForms = 2;

/** The token forms the runtime's `Token<T>` union must still declare. */
const requiredRuntimeTokenForms: readonly string[] = ["ClassToken", "InjectionToken"];

/**
 * A floor under the runtime scan, so a glob that stopped matching cannot pass by
 * finding nothing: a renamed or moved directory drops the count. It is a floor
 * rather than an exact number because adding a source file legitimately raises
 * it.
 */
const minimumRuntimeSourceFiles = 29;

/**
 * The runtime files the readers below must reach. One per pattern would not do
 * here — a single glob names them all — so these are the files a reader would
 * go quiet over if the package were reorganised, named explicitly.
 */
const requiredRuntimeSourceFiles: readonly string[] = [
  "packages/common/src/decorators/decorators.ts",
  "packages/common/src/decorators/decorators.types.ts",
  "packages/common/src/enhancers/enhancer-decorators.ts",
  "packages/common/src/enhancers/enhancer-decorators.types.ts",
  "packages/common/src/index.ts",
  "packages/common/src/routing/route-parameters.ts",
  "packages/common/src/routing/route-schema.ts",
  "packages/common/src/routing/validation.ts",
  "packages/common/src/websockets/websocket-gateway.ts",
  "packages/common/src/websockets/websocket-gateway.types.ts",
];

/**
 * A floor under the decorator enumeration, so a reader that stopped recognising
 * the decorator shape cannot pass by finding none. The count today is 31, across
 * the five modules that export one.
 */
const minimumRuntimeDecorators = 31;

/**
 * One decorator from each family, so no single module's reader can satisfy the
 * enumeration above on its own.
 */
const requiredRuntimeDecorators: readonly string[] = [
  "Catch",
  "Controller",
  "Get",
  "Body",
  "HttpStatus",
  "UseGuards",
  "UseInterceptors",
  "UseFilters",
  "Module",
  "Injectable",
  "Inject",
  "Validation",
  "WebSocketGateway",
  "SubscribeMessage",
  "MessageBody",
  "ConnectedSocket",
  "WebSocketServer",
];

/** One metadata key per decorator family, so the key scan is not vacuous. */
const requiredRuntimeMetadataKeys: readonly string[] = [
  "aponia.controller.metadata",
  "aponia.module.metadata",
  "aponia.route.metadata",
  "aponia.route-parameters.metadata",
  "aponia.injected-tokens.metadata",
  "aponia.validation.metadata",
  "aponia.enhancer-class.metadata",
  "aponia.enhancer-method.metadata",
  "aponia.enhancer-catch.metadata",
  "aponia.websocket-gateway.metadata",
  "aponia.websocket-message.metadata",
  "aponia.websocket-parameters.metadata",
  "aponia.websocket-server-properties.metadata",
];

const runtimeSourcePaths = Object.freeze(
  (
    await Array.fromAsync(
      new Glob(`${runtimeSourceRoot}/**/*.ts`).scan({
        cwd: repositoryRoot,
        onlyFiles: true,
      }),
    )
  ).toSorted(),
);

const runtimeSources: ReadonlyMap<string, string> = new Map(
  await Promise.all(
    runtimeSourcePaths.map(
      async (path) => [path, await Bun.file(resolve(repositoryRoot, path)).text()] as const,
    ),
  ),
);

const cliSourcePaths = Object.freeze(
  [
    ...new Set([
      ...[...cliAnalyses.values()].flat().map((reading) => reading.file),
      ...repeatedUnions.map((union) => union.cliFile),
      ...platformArtifactPairs.map((pair) => pair.cliFile),
    ]),
  ].toSorted(),
);

const cliSources: ReadonlyMap<string, string> = new Map(
  await Promise.all(
    cliSourcePaths.map(
      async (path) => [path, await Bun.file(resolve(repositoryRoot, path)).text()] as const,
    ),
  ),
);

/** The platform artifact type modules the shape comparison reads. */
const platformArtifactSourcePaths = Object.freeze(
  [...new Set(platformArtifactPairs.map((pair) => pair.platformFile))].toSorted(),
);

const platformArtifactSources: ReadonlyMap<string, string> = new Map(
  await Promise.all(
    platformArtifactSourcePaths.map(
      async (path) => [path, await Bun.file(resolve(repositoryRoot, path)).text()] as const,
    ),
  ),
);

/** The runtime decorators, read out of every runtime source file. */
const runtimeDecorators = Object.freeze(
  [
    ...new Set(
      runtimeSourcePaths.flatMap((path) => readDecoratorFactories(runtimeSources.get(path)!)),
    ),
  ].toSorted(),
);

/** The `Symbol.for(...)` keys the runtime writes, read out of every runtime source. */
const runtimeMetadataKeys = Object.freeze(
  [
    ...new Set(runtimeSourcePaths.flatMap((path) => readMetadataKeys(runtimeSources.get(path)!))),
  ].toSorted(),
);

function readRuntimeMembers(reference: RepeatedUnion): readonly string[] {
  const content = runtimeSources.get(reference.runtimeFile);
  if (content === undefined) {
    throw new Error(`${reference.runtimeFile} is not part of the runtime scan.`);
  }

  switch (reference.runtimeReading) {
    case "string-union":
      return readStringUnion(content, reference.runtimeName);
    case "string-array":
      return readStringArrayConstant(content, reference.runtimeName);
    case "interface-properties":
      return readInterfacePropertyNames(content, reference.runtimeName);
  }
}

function readCliMembers(reference: RepeatedUnion): readonly string[] {
  const content = cliSources.get(reference.cliFile);
  if (content === undefined) {
    throw new Error(`${reference.cliFile} is not part of the CLI scan.`);
  }

  return reference.cliReading === "string-union"
    ? readStringUnion(content, reference.cliName)
    : readStringArrayConstant(content, reference.cliName);
}

/** The fields the platform interface a pair names declares. */
function readPlatformArtifactFields(pair: PlatformArtifactFieldPair): readonly string[] {
  const content = platformArtifactSources.get(pair.platformFile);
  if (content === undefined) {
    throw new Error(`${pair.platformFile} is not part of the platform artifact scan.`);
  }

  return readInterfacePropertyNames(content, pair.platformInterface);
}

/** The fields the CLI surface a pair names states. */
function readCliArtifactFields(pair: PlatformArtifactFieldPair): readonly string[] {
  const content = cliSources.get(pair.cliFile);
  if (content === undefined) {
    throw new Error(`${pair.cliFile} is not part of the CLI scan.`);
  }

  return pair.cliReading.kind === "interface"
    ? readInterfacePropertyNames(content, pair.cliReading.name)
    : readEmittedArtifactKeys(content, pair.cliReading.exportName);
}

/** The names one CLI analysis states it recognises, across all its readings. */
function readRecognizedNames(readings: readonly CliReading[]): ReadonlySet<string> {
  const names = new Set<string>();

  for (const reading of readings) {
    const content = cliSources.get(reading.file);
    if (content === undefined) {
      throw new Error(`${reading.file} is not part of the CLI scan.`);
    }

    if (reading.kind === "string-constant") {
      names.add(readStringConstant(content, reading.name));
      continue;
    }

    for (const [name] of readMapEntries(content, reading.name)) {
      names.add(name);
    }
  }

  return names;
}

const recognizedNamesByAnalysis: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  [...cliAnalyses].map(([analysis, readings]) => [analysis, readRecognizedNames(readings)]),
);

/**
 * The names a runtime surface states that nothing accounts for: no mapping and
 * no stated reason to go unread, or a mapping naming an analysis this guard
 * does not read.
 */
function findUnaccounted(
  runtimeNames: readonly string[],
  analyses: ReadonlyMap<string, string>,
  unread: ReadonlyMap<string, string>,
  knownAnalyses: ReadonlySet<string>,
): readonly string[] {
  const problems: string[] = [];

  for (const name of runtimeNames) {
    const analysis = analyses.get(name);
    if (analysis === undefined) {
      if (!unread.has(name)) {
        problems.push(
          `${name} is neither mapped to a CLI analysis nor listed as deliberately unread`,
        );
      }
      continue;
    }

    if (!knownAnalyses.has(analysis)) {
      problems.push(`${name} names a CLI analysis this guard does not read: ${analysis}`);
    }
  }

  return Object.freeze(problems);
}

/**
 * The names a runtime surface states that no CLI analysis accounts for, which
 * for a decorator also means the analysis it maps to does not recognise it —
 * the case this whole guard exists for.
 */
function findCoverageProblems(
  runtimeNames: readonly string[],
  analyses: ReadonlyMap<string, string>,
  unread: ReadonlyMap<string, string>,
  recognized: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const problems: string[] = [
    ...findUnaccounted(runtimeNames, analyses, unread, new Set(recognized.keys())),
  ];

  for (const name of runtimeNames) {
    const analysis = analyses.get(name);
    const names = analysis === undefined ? undefined : recognized.get(analysis);
    if (names !== undefined && !names.has(name)) {
      problems.push(`${name} must be recognised by ${analysis}`);
    }
  }

  return Object.freeze(problems);
}

/** The members one side of a repeated union states that the other does not. */
function findUnionDrift(
  runtime: readonly string[],
  cli: readonly string[],
): Readonly<{ readonly missing: readonly string[]; readonly extra: readonly string[] }> {
  return Object.freeze({
    missing: Object.freeze(runtime.filter((member) => !cli.includes(member))),
    extra: Object.freeze(cli.filter((member) => !runtime.includes(member))),
  });
}

/**
 * The fields one side of a restated artifact states that the other does not.
 *
 * A field listed in `platformOnly` is one the CLI reading legitimately omits, so
 * it is not reported missing; it is still reported when the CLI invents a field
 * the platform does not declare, because an extra field fails loudly on the
 * platform's own type check rather than silently serving less.
 */
function findFieldDrift(
  platform: readonly string[],
  cli: readonly string[],
  platformOnly: ReadonlyMap<string, string>,
): Readonly<{ readonly missing: readonly string[]; readonly extra: readonly string[] }> {
  return Object.freeze({
    missing: Object.freeze(
      platform.filter((field) => !cli.includes(field) && !platformOnly.has(field)),
    ),
    extra: Object.freeze(cli.filter((field) => !platform.includes(field))),
  });
}

/** How a stated token-form correspondence and the two member sets disagree. */
interface TokenFormDrift {
  /** Runtime members no correspondence row accounts for. */
  readonly missing: readonly string[];
  /** CLI members no correspondence row accounts for. */
  readonly extra: readonly string[];
  /** Correspondence rows naming a runtime member the runtime no longer states. */
  readonly staleRuntime: readonly string[];
  /** Correspondence rows naming a CLI member the CLI no longer states. */
  readonly staleCli: readonly string[];
}

/**
 * The token forms each side states that the correspondence does not tie to the
 * other, in both directions, plus the rows left behind by a rename.
 */
function findTokenFormDrift(
  runtimeMembers: readonly string[],
  cliMembers: readonly string[],
  correspondence: readonly TokenFormCorrespondence[],
): TokenFormDrift {
  return Object.freeze({
    missing: Object.freeze(
      runtimeMembers.filter(
        (member) => !correspondence.some((row) => row.runtimeMember === member),
      ),
    ),
    extra: Object.freeze(
      cliMembers.filter((member) => !correspondence.some((row) => row.cliMember === member)),
    ),
    staleRuntime: Object.freeze(
      correspondence
        .map((row) => row.runtimeMember)
        .filter((member) => !runtimeMembers.includes(member)),
    ),
    staleCli: Object.freeze(
      correspondence.map((row) => row.cliMember).filter((member) => !cliMembers.includes(member)),
    ),
  });
}

describe("CLI runtime surface", () => {
  test("the runtime scan reaches the modules it reads", () => {
    expect(
      runtimeSourcePaths.length,
      `the scan reached ${runtimeSourcePaths.length} runtime files, under the ${minimumRuntimeSourceFiles} a scan that still matches would reach`,
    ).toBeGreaterThanOrEqual(minimumRuntimeSourceFiles);

    expect(
      requiredRuntimeSourceFiles.filter((path) => !runtimeSourcePaths.includes(path)),
      "runtime files the scan no longer reaches",
    ).toEqual([]);
  });

  test("the decorator enumeration still recognises the decorator shape", () => {
    expect(
      runtimeDecorators.length,
      `the reader found ${runtimeDecorators.length} decorators, under the ${minimumRuntimeDecorators} a reader that still matches would find`,
    ).toBeGreaterThanOrEqual(minimumRuntimeDecorators);

    expect(
      requiredRuntimeDecorators.filter((name) => !runtimeDecorators.includes(name)),
      "decorators the reader no longer recognises",
    ).toEqual([]);
  });

  test("every decorator @aponiajs/common exports is recognised by the CLI analysis that lowers it", () => {
    expect(
      findCoverageProblems(
        runtimeDecorators,
        decoratorAnalyses,
        unreadDecorators,
        recognizedNamesByAnalysis,
      ),
      "teach the named analysis to read the decorator, or list it in unreadDecorators with the reason it need not be",
    ).toEqual([]);
  });

  test("every metadata key the runtime reads is accounted for", () => {
    expect(
      requiredRuntimeMetadataKeys.filter((key) => !runtimeMetadataKeys.includes(key)),
      "metadata keys the reader no longer finds",
    ).toEqual([]);

    expect(
      findUnaccounted(
        runtimeMetadataKeys,
        metadataKeyAnalyses,
        unreadMetadataKeys,
        new Set(recognizedNamesByAnalysis.keys()),
      ),
      "teach the named analysis to account for the key, or list it in unreadMetadataKeys with the reason it need not be",
    ).toEqual([]);
  });

  test("the guard's own mappings name declarations the runtime still writes", () => {
    expect(
      [...decoratorAnalyses.keys(), ...unreadDecorators.keys()].filter(
        (name) => !runtimeDecorators.includes(name),
      ),
      "decorator mappings left behind by a rename",
    ).toEqual([]);

    expect(
      [...metadataKeyAnalyses.keys(), ...unreadMetadataKeys.keys()].filter(
        (key) => !runtimeMetadataKeys.includes(key),
      ),
      "metadata mappings left behind by a rename",
    ).toEqual([]);
  });

  test("every CLI analysis the guard names is one it reads", () => {
    const analyses = [...decoratorAnalyses.values(), ...metadataKeyAnalyses.values()].filter(
      (analysis) => !recognizedNamesByAnalysis.has(analysis),
    );

    expect(analyses, "mappings that name an analysis the guard does not read").toEqual([]);
  });

  for (const union of repeatedUnions) {
    test(`the CLI's ${union.cliName} is the runtime's ${union.runtimeName}`, () => {
      const runtime = readRuntimeMembers(union);
      const cli = readCliMembers(union);

      expect(
        runtime.length,
        `${union.runtimeName} in ${union.runtimeFile} read as ${runtime.length} members`,
      ).toBeGreaterThan(0);
      expect(
        findUnionDrift(runtime, cli),
        `${union.cliName} in ${union.cliFile} must state exactly the members ${union.runtimeName} declares in ${union.runtimeFile}`,
      ).toEqual({ missing: [], extra: [] });

      if (union.ordered) {
        expect(cli, `${union.cliName} must repeat the runtime's order`).toEqual(runtime);
      }
    });
  }

  test("the kinds the CLI maps each decorator to are the runtime's own union members", () => {
    const routesBaseline = readMapEntries(
      cliSources.get(controllerRoutesFile)!,
      "requestMethodDecorators",
    );
    const parameterBaseline = readMapEntries(
      cliSources.get(controllerRoutesFile)!,
      "parameterDecorators",
    );
    const enhancerBaseline = readMapEntries(
      cliSources.get(controllerRoutesFile)!,
      "enhancerDecorators",
    );

    const requestMethods = readStringUnion(
      runtimeSources.get("packages/common/src/decorators/decorators.types.ts")!,
      "RequestMethod",
    );
    const parameterKinds = readStringArrayConstant(
      runtimeSources.get("packages/common/src/routing/route-parameters.ts")!,
      "routeParameterKinds",
    );
    const enhancerKinds = readInterfacePropertyNames(
      runtimeSources.get("packages/common/src/enhancers/enhancer-decorators.types.ts")!,
      "EnhancerMetadata",
    );

    const mappings: readonly (readonly [
      string,
      readonly (readonly [string, string])[],
      readonly string[],
    ])[] = [
      ["requestMethodDecorators", routesBaseline, requestMethods],
      ["parameterDecorators", parameterBaseline, parameterKinds],
      ["enhancerDecorators", enhancerBaseline, enhancerKinds],
    ];

    for (const [name, entries, members] of mappings) {
      expect(
        entries.filter(([, kind]) => !members.includes(kind)),
        `kinds ${name} maps a decorator to that the runtime does not declare`,
      ).toEqual([]);
    }
  });

  test("the platform artifact table still reads the artifacts and fields it names", () => {
    expect(
      platformArtifactPairs.length,
      `the table holds ${platformArtifactPairs.length} pairs, under the ${minimumPlatformArtifactPairs} a table that still matches would hold`,
    ).toBeGreaterThanOrEqual(minimumPlatformArtifactPairs);

    expect(
      requiredPlatformArtifactFiles.filter((path) => !platformArtifactSourcePaths.includes(path)),
      "platform artifact files the scan no longer reaches",
    ).toEqual([]);

    const fields = new Set(
      platformArtifactPairs.flatMap((pair) => readPlatformArtifactFields(pair)),
    );
    expect(
      requiredPlatformArtifactFields.filter((field) => !fields.has(field)),
      "platform artifact fields the readers no longer find",
    ).toEqual([]);
  });

  for (const pair of platformArtifactPairs) {
    test(`the CLI restates every field the platform's ${pair.platformInterface} consumes`, () => {
      const platform = readPlatformArtifactFields(pair);
      const cli = readCliArtifactFields(pair);

      expect(
        platform.length,
        `${pair.platformInterface} in ${pair.platformFile} read as ${platform.length} fields`,
      ).toBeGreaterThan(0);
      expect(
        cli.length,
        `${pair.description} in ${pair.cliFile} read as ${cli.length} fields`,
      ).toBeGreaterThan(0);

      expect(
        findFieldDrift(platform, cli, pair.platformOnly),
        `${pair.description} in ${pair.cliFile} must state exactly the fields ${pair.platformInterface} declares in ${pair.platformFile}`,
      ).toEqual({ missing: [], extra: [] });
    });
  }

  test("every stated platform-only artifact field is still one the CLI reading omits", () => {
    const problems: string[] = [];

    for (const pair of platformArtifactPairs) {
      const platform = readPlatformArtifactFields(pair);
      const cli = readCliArtifactFields(pair);

      for (const field of pair.platformOnly.keys()) {
        if (!platform.includes(field)) {
          problems.push(
            `${field} is a stated exception on ${pair.platformInterface}, which no longer declares it`,
          );
        }
        if (cli.includes(field)) {
          problems.push(
            `${field} is a stated exception on ${pair.description}, which now states it`,
          );
        }
      }
    }

    expect(problems, "artifact-field exceptions left behind by a change").toEqual([]);
  });

  test("the CLI's AnalyzedTokenKind still accounts for the runtime's token forms", () => {
    const runtimeMembers = readTypeAliasUnionMembers(runtimeSources.get(tokenTypesFile)!, "Token");
    const cliMembers = readStringUnion(
      cliSources.get(moduleDescriptorsTypesFile)!,
      "AnalyzedTokenKind",
    );

    expect(
      runtimeMembers.length,
      `Token in ${tokenTypesFile} read as ${runtimeMembers.length} members`,
    ).toBeGreaterThanOrEqual(minimumRuntimeTokenForms);
    expect(
      requiredRuntimeTokenForms.filter((member) => !runtimeMembers.includes(member)),
      "token forms the reader no longer finds",
    ).toEqual([]);

    expect(
      findTokenFormDrift(runtimeMembers, cliMembers, tokenFormCorrespondence),
      `AnalyzedTokenKind in ${moduleDescriptorsTypesFile} must account for every member Token declares in ${tokenTypesFile}, and the correspondence must name no member either side dropped`,
    ).toEqual({ missing: [], extra: [], staleRuntime: [], staleCli: [] });
  });
});

describe("CLI runtime surface guard", () => {
  test("the decorator reader takes a factory and leaves a getter", () => {
    const source = [
      "export function UsePipes(): ClassDecorator {",
      "  return () => {};",
      "}",
      "",
      "export function getPipeMetadata(target: object): Readonly<PipeMetadata> {",
      "  return Reflect.getOwnMetadata(pipeKey, target);",
      "}",
      "",
      'export const List = createListDecorator("list");',
      "",
      "function createListDecorator(kind: string): ParameterDecorator {",
      "  return () => {};",
      "}",
      "",
    ].join("\n");

    expect(readDecoratorFactories(source)).toEqual(["List", "UsePipes"]);
  });

  test("a decorator the CLI does not recognise is reported with the analysis that must read it", () => {
    const withUnknownDecorator = Object.freeze([...runtimeDecorators, "UsePipes"]);
    const analyses = new Map(decoratorAnalyses).set(
      "UsePipes",
      "controller-routes.ts's enhancerDecorators",
    );

    expect(
      findCoverageProblems(
        runtimeDecorators,
        analyses,
        unreadDecorators,
        recognizedNamesByAnalysis,
      ),
      "the control's input must differ from the real one only by the decorator it adds",
    ).toEqual([]);

    expect(
      findCoverageProblems(
        withUnknownDecorator,
        analyses,
        unreadDecorators,
        recognizedNamesByAnalysis,
      ),
      "a decorator the CLI cannot read but is mapped to one must name that analysis",
    ).toEqual(["UsePipes must be recognised by controller-routes.ts's enhancerDecorators"]);
  });

  test("a decorator no analysis claims is reported as unmapped", () => {
    expect(
      findCoverageProblems(
        ["UsePipes"],
        decoratorAnalyses,
        unreadDecorators,
        recognizedNamesByAnalysis,
      ),
      "a runtime decorator nothing maps is the drift this guard exists for",
    ).toEqual(["UsePipes is neither mapped to a CLI analysis nor listed as deliberately unread"]);
  });

  test("a union member the CLI does not carry fails in both directions", () => {
    const runtime = readStringArrayConstant(
      runtimeSources.get("packages/common/src/routing/route-parameters.ts")!,
      "routeParameterKinds",
    );

    expect(findUnionDrift(runtime, runtime), "a guard against itself must find nothing").toEqual({
      missing: [],
      extra: [],
    });

    expect(findUnionDrift([...runtime, "file"], runtime)).toEqual({
      missing: ["file"],
      extra: [],
    });
    expect(findUnionDrift(runtime, [...runtime, "file"])).toEqual({
      missing: [],
      extra: ["file"],
    });
  });

  test("an artifact field the CLI omits fails in both directions", () => {
    const platform = ["framework", "elysia", "modules"];
    const cli = [...platform];
    const none = new Map<string, string>();

    expect(findFieldDrift(platform, cli, none), "a guard against itself must find nothing").toEqual(
      { missing: [], extra: [] },
    );

    expect(findFieldDrift([...platform, "invokers"], cli, none)).toEqual({
      missing: ["invokers"],
      extra: [],
    });
    expect(findFieldDrift(platform, [...cli, "invokers"], none)).toEqual({
      missing: [],
      extra: ["invokers"],
    });
    expect(
      findFieldDrift(
        [...platform, "invokers"],
        cli,
        new Map([["invokers", "the emitter builds it"]]),
      ),
      "a field with a stated exception must not be reported missing",
    ).toEqual({ missing: [], extra: [] });
  });

  test("a token form the CLI does not carry is reported in both directions", () => {
    const correspondence: readonly TokenFormCorrespondence[] = [
      { runtimeMember: "ClassToken", cliMember: "reference" },
      { runtimeMember: "InjectionToken", cliMember: "injection-token" },
    ];
    const runtime = ["ClassToken", "InjectionToken"];
    const cli = ["reference", "injection-token"];
    const aligned = { missing: [], extra: [], staleRuntime: [], staleCli: [] };

    expect(
      findTokenFormDrift(runtime, cli, correspondence),
      "a guard against its own correspondence must find nothing",
    ).toEqual(aligned);

    expect(findTokenFormDrift([...runtime, "FactoryToken"], cli, correspondence)).toEqual({
      ...aligned,
      missing: ["FactoryToken"],
    });
    expect(findTokenFormDrift(runtime, [...cli, "factory"], correspondence)).toEqual({
      ...aligned,
      extra: ["factory"],
    });
    expect(findTokenFormDrift(["ClassToken"], cli, correspondence)).toEqual({
      ...aligned,
      staleRuntime: ["InjectionToken"],
    });
    expect(findTokenFormDrift(runtime, ["reference"], correspondence)).toEqual({
      ...aligned,
      staleCli: ["injection-token"],
    });
  });
});
