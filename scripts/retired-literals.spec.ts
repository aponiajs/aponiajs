import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

const repositoryRoot = resolve(import.meta.dir, "..");

/**
 * Literals this framework has retired, and what replaced them.
 *
 * A literal is what a surface states in a value's place, so a document that names
 * one the code no longer emits describes a payload no reader will see. Nothing
 * compiles a document, which is why a rename is the change that leaves this class
 * of defect behind, and why it is guarded here rather than reviewed.
 */
interface RetiredLiteral {
  readonly literal: string;
  readonly replacedBy: string;
  /**
   * How a surface is read for the literal.
   *
   * `substring` is the default and is right for a literal that cannot occur
   * inside a live value. `identifier` matches a whole identifier, which is what
   * a retired *name* needs: `Set` sits inside the `ResponseSettings` that
   * replaced it, `Status` inside `HttpStatus`, and `tokenName` inside
   * `getTokenName`, so a substring scan would fail on the very name it is
   * asking for.
   */
  readonly match?: "substring" | "identifier";
  /**
   * Repository-relative paths that may state the literal.
   *
   * A retired name a dependency still legitimately exports needs this. The
   * framework's own alias for Elysia's `status()` escape hatch was retired, but
   * the installed Elysia exports a class under that exact name, and the one
   * module that declines it has to import the dependency's class rather than a
   * name of its own. A path here is the exception rather than the rule, so it
   * names the file and never a directory.
   */
  readonly except?: readonly string[];
}

const retiredLiterals: readonly RetiredLiteral[] = [
  { literal: "[unprojectable]", replacedBy: "[unrenderable]" },
  // Declaration-time decorators, renamed so each names what it hands a handler
  // rather than the field of the platform context it came from.
  //
  // These are stated in their applied form, `@Name`, and not as bare
  // identifiers. Every one of them is an ordinary English word or a JavaScript
  // built-in — `Store` is a word, `Set` is `new Set()`, `Status` is what a
  // paragraph about HTTP says — so a bare-identifier scan reports prose and
  // library code that never mentioned the decorator. The applied form is what
  // a reader writes and what a document shows, and it cannot collide with
  // either.
  { literal: "@Set", replacedBy: "@ResponseSettings", match: "identifier" },
  { literal: "@Res", replacedBy: "@ResponseSettings", match: "identifier" },
  { literal: "@Status", replacedBy: "@HttpStatus", match: "identifier" },
  { literal: "@Store", replacedBy: "@State", match: "identifier" },
  { literal: "@Ctx", replacedBy: "@Context", match: "identifier" },
  // Contracts, renamed to stop naming the platform's mechanics.
  { literal: "NativeSchema", replacedBy: "ValidatorSchema", match: "identifier" },
  { literal: "DefinedModule", replacedBy: "ModuleDescriptor", match: "identifier" },
  { literal: "TokenValues", replacedBy: "TokenMap", match: "identifier" },
  { literal: "AponiaInterceptor", replacedBy: "Interceptor", match: "identifier" },
  {
    literal: "RouteResponseSettings",
    replacedBy: "ResponseSettingsState",
    match: "identifier",
  },
  // Functions, renamed to say that they read something.
  { literal: "tokenName", replacedBy: "getTokenName", match: "identifier" },
  { literal: "renderLogValue", replacedBy: "formatLogValue", match: "identifier" },
  {
    literal: "providerDependencies",
    replacedBy: "getProviderDependencies",
    match: "identifier",
  },
  // platform-elysia: names retired when the prefix attributed an Aponia
  // abstraction to Elysia. The type that stays prefixed is the one that really
  // is Elysia's own `set` object, and it carries the prefix honestly.
  { literal: "ElysiaRouteContext", replacedBy: "HandlerContext", match: "identifier" },
  { literal: "ElysiaSet", replacedBy: "ElysiaResponseSettings", match: "identifier" },
  { literal: "ElysiaStore", replacedBy: "AppState", match: "identifier" },
  { literal: "ElysiaInputSchema", replacedBy: "RouteInputSchema", match: "identifier" },
  {
    literal: "ElysiaCompilationOptions",
    replacedBy: "RouteCompilationOptions",
    match: "identifier",
  },
  { literal: "NativeElysiaConfigurator", replacedBy: "ElysiaConfigurator", match: "identifier" },
  { literal: "AponiaNativeApplication", replacedBy: "ElysiaApplication", match: "identifier" },
  { literal: "AponiaElysiaApplication", replacedBy: "AponiaApplication", match: "identifier" },
  { literal: "AponiaRouteInvoker", replacedBy: "RouteHandler", match: "identifier" },
  {
    literal: "AponiaControllerInvokerFactory",
    replacedBy: "ControllerHandlerFactory",
    match: "identifier",
  },
  { literal: "InterceptorHalves", replacedBy: "InterceptorPhases", match: "identifier" },
  { literal: "defineElysiaController", replacedBy: "defineController", match: "identifier" },
  {
    literal: "defineElysiaControllerRoutes",
    replacedBy: "defineControllerRoutes",
    match: "identifier",
  },
  { literal: "elysiaController", replacedBy: "controller", match: "identifier" },
  { literal: "ELYSIA_CONTROLLER", replacedBy: "CONTROLLER_KIND", match: "identifier" },
  {
    literal: "ElysiaControllerDefinition",
    replacedBy: "ControllerDescriptor",
    match: "identifier",
  },
  {
    literal: "ElysiaControllerPluginOptions",
    replacedBy: "ControllerPluginOptions",
    match: "identifier",
  },
  {
    literal: "ElysiaControllerRegistrationOptions",
    replacedBy: "ControllerRegistrationOptions",
    match: "identifier",
  },
  {
    literal: "ElysiaControllerRegistrationResult",
    replacedBy: "ControllerRegistrationResult",
    match: "identifier",
  },
  {
    literal: "ElysiaControllerRoutesOptions",
    replacedBy: "ControllerRoutesOptions",
    match: "identifier",
  },
  {
    literal: "DeclaredElysiaControllerDefinition",
    replacedBy: "DeclaredControllerDefinition",
    match: "identifier",
  },
  {
    literal: "RegisteredElysiaControllerDefinition",
    replacedBy: "RegisteredControllerDefinition",
    match: "identifier",
  },
  {
    literal: "RegisteredElysiaApplication",
    replacedBy: "RegisteredApplication",
    match: "identifier",
  },
  { literal: "ElysiaRoutePlan", replacedBy: "RoutePlan", match: "identifier" },
  { literal: "defineElysiaPlugin", replacedBy: "definePlugin", match: "identifier" },
  { literal: "ElysiaPluginModule", replacedBy: "PluginModule", match: "identifier" },
  { literal: "ElysiaPluginImport", replacedBy: "PluginImport", match: "identifier" },
  { literal: "ElysiaPluginModuleOptions", replacedBy: "PluginModuleOptions", match: "identifier" },
  {
    literal: "AsyncElysiaPluginModuleOptions",
    replacedBy: "AsyncPluginModuleOptions",
    match: "identifier",
  },
  { literal: "NativeElysiaPlugin", replacedBy: "ElysiaPlugin", match: "identifier" },
  { literal: "ElysiaPluginSource", replacedBy: "PluginSource", match: "identifier" },
  { literal: "ElysiaPluginTypes", replacedBy: "PluginTypes", match: "identifier" },
  {
    literal: "defineElysiaWebSocketGateway",
    replacedBy: "defineWebSocketGateway",
    match: "identifier",
  },
  { literal: "ElysiaWebSocketServer", replacedBy: "WebSocketServerRef", match: "identifier" },
  { literal: "ElysiaWebSocket", replacedBy: "WebSocketClient", match: "identifier" },
  {
    literal: "ElysiaWebSocketGatewayOptions",
    replacedBy: "WebSocketGatewayOptions",
    match: "identifier",
  },
  {
    literal: "ElysiaWebSocketGatewayPlan",
    replacedBy: "WebSocketGatewayPlan",
    match: "identifier",
  },
  {
    literal: "ElysiaWebSocketHandlerPlan",
    replacedBy: "WebSocketHandlerPlan",
    match: "identifier",
  },
  {
    literal: "DeclaredElysiaWebSocketGateway",
    replacedBy: "DeclaredWebSocketGateway",
    match: "identifier",
  },
  {
    literal: "readApplicationDiagnostics",
    replacedBy: "getApplicationDiagnostics",
    match: "identifier",
  },
  {
    literal: "readApplicationFromStore",
    replacedBy: "getApplicationFromStore",
    match: "identifier",
  },
  // Elysia exports a class under this name, and the one module that has to
  // decline that class imports it, so it is the exception the `except` field
  // exists for.
  {
    literal: "ElysiaStatus",
    replacedBy: "ResponseStatus",
    match: "identifier",
    except: ["packages/platform-elysia/src/errors/default-exception-filter.ts"],
  },
  // devtools: the `/aot` and `/flow` families renamed to say what they report.
  { literal: "AponiaAotController", replacedBy: "AponiaBuildController", match: "identifier" },
  { literal: "AponiaAotGraph", replacedBy: "AponiaBuildGraph", match: "identifier" },
  { literal: "AponiaAotHandler", replacedBy: "AponiaBuildHandler", match: "identifier" },
  { literal: "AponiaAotInvoker", replacedBy: "AponiaBuildInvoker", match: "identifier" },
  { literal: "AponiaAotInvokers", replacedBy: "AponiaBuildInvokers", match: "identifier" },
  { literal: "AponiaAotPayload", replacedBy: "AponiaBuildPayload", match: "identifier" },
  { literal: "AponiaAotFacts", replacedBy: "AponiaBuildFacts", match: "identifier" },
  { literal: "AponiaFlowFilter", replacedBy: "AponiaRouteTraceFilter", match: "identifier" },
  { literal: "AponiaFlowPayload", replacedBy: "AponiaRouteTracePayload", match: "identifier" },
  { literal: "AponiaFlowRoute", replacedBy: "AponiaRouteTrace", match: "identifier" },
  { literal: "AponiaFlowScope", replacedBy: "AponiaRouteStageScope", match: "identifier" },
  { literal: "AponiaFlowStage", replacedBy: "AponiaRouteStage", match: "identifier" },
  { literal: "AponiaFlowStageKind", replacedBy: "AponiaRouteStageKind", match: "identifier" },
  { literal: "AponiaRouteSource", replacedBy: "AponiaRouteBinding", match: "identifier" },
  { literal: "routeRequest", replacedBy: "handleDevtoolsRequest", match: "identifier" },
  { literal: "tapLogBuffer", replacedBy: "recordLogger", match: "identifier" },
  { literal: "TappedLogStream", replacedBy: "LogStream", match: "identifier" },
  { literal: "resolveElysiaVersion", replacedBy: "resolvePeerVersion", match: "identifier" },
  // cli: functions that read or build renamed around the noun they return.
  { literal: "generateSchematics", replacedBy: "schematicNames", match: "identifier" },
  { literal: "aponiaBuildPlugin", replacedBy: "buildPlugin", match: "identifier" },
  { literal: "aponiaBuildPluginName", replacedBy: "buildPluginName", match: "identifier" },
  { literal: "AponiaBuildPluginOptions", replacedBy: "BuildPluginOptions", match: "identifier" },
];

/** A literal read as a whole identifier rather than as any occurrence of it. */
function statesRetiredIdentifier(content: string, literal: string): boolean {
  const escaped = literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(content);
}

/**
 * The surfaces a reader meets: published documents, package guides, sources, the
 * templates a build ships, the examples, and the tests that state what a surface
 * emits.
 *
 * `docs/superpowers/` is deliberately outside the set. A spec or a plan is the
 * record of a change, so it names the literal it retired on purpose. This guard
 * is inside `scripts/`, which is a covered surface, and it states one as its own
 * data, so it is skipped by name below rather than by sitting outside a pattern.
 *
 * Every pattern is resolved against the repository root rather than the process
 * working directory, so the scan covers the same set wherever it is run from
 * instead of passing over a near-empty one.
 */
const publishedSurfaces = [
  "README.md",
  "AGENTS.md",
  "RULES.md",
  "docs/*.md",
  "docs/learn/*.md",
  "examples/**/*.{ts,md,json}",
  "packages/*/README.md",
  "packages/*/llms.txt",
  "packages/*/AGENTS.md",
  "packages/*/src/**/*.ts",
  "packages/*/tests/**/*.ts",
  "packages/*/tests-vp/**/*.ts",
  "packages/*/e2e/**/*.ts",
  "packages/cli/templates/**",
  "scripts/**/*.ts",
] as const;

/**
 * The one file the surfaces above match that may name a retired literal: this
 * guard, which states one as its own data. Kept as a list rather than by leaving
 * `scripts/` unscanned, so the rest of this directory — and every guard added
 * beside it — stays covered.
 */
const dataFiles: readonly string[] = ["scripts/retired-literals.spec.ts"];

/**
 * A floor under the scan, so a surface list that stopped matching cannot pass by
 * finding nothing: a renamed directory, a moved template, or a dropped pattern
 * leaves the count short. It is a floor rather than an exact number because
 * adding a surface legitimately raises it.
 */
const minimumScannedFiles = 400;

/**
 * One file per pattern, so the floor above cannot be met by one pattern that
 * happens to reach a large directory while another reaches none. A path here is
 * a file a reader meets, so its loss is a change worth failing over.
 */
const requiredFiles: readonly string[] = [
  "AGENTS.md",
  "README.md",
  "RULES.md",
  "docs/logging.md",
  "docs/learn/README.md",
  "examples/basic/src/main.ts",
  "packages/cli/e2e/generated-application.e2e.ts",
  "packages/cli/templates/application/src/main.ts.tmpl",
  "packages/common/src/logging/log-value.ts",
  "packages/devtools/AGENTS.md",
  "packages/devtools/README.md",
  "packages/devtools/llms.txt",
  "packages/devtools/tests/one-line.test.ts",
  "packages/devtools/tests-vp/devtools.conformance.ts",
  "scripts/verify-release.ts",
];

describe("retired literals", () => {
  for (const retired of retiredLiterals) {
    test(`no published surface states ${retired.literal}`, async () => {
      const scanned = new Set<string>();
      const offenders: string[] = [];

      for (const pattern of publishedSurfaces) {
        const scan = new Glob(pattern).scan({ cwd: repositoryRoot, onlyFiles: true });

        for await (const path of scan) {
          if (dataFiles.includes(path)) {
            continue;
          }

          scanned.add(path);

          if (retired.except?.includes(path)) {
            continue;
          }

          const content = await Bun.file(join(repositoryRoot, path)).text();
          const states =
            retired.match === "identifier"
              ? statesRetiredIdentifier(content, retired.literal)
              : content.includes(retired.literal);
          if (states) {
            offenders.push(path);
          }
        }
      }

      expect(
        scanned.size,
        `the scan reached ${scanned.size} files, under the ${minimumScannedFiles} a surface list that still matches would reach`,
      ).toBeGreaterThanOrEqual(minimumScannedFiles);

      expect(
        requiredFiles.filter((path) => !scanned.has(path)),
        "surface patterns that reached none of the files they name",
      ).toEqual([]);

      expect(
        offenders.sort(),
        `${retired.literal} is retired; a surface states ${retired.replacedBy} instead`,
      ).toEqual([]);
    });
  }
});
