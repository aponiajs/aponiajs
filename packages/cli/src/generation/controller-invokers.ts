import type {
  AnalyzedController,
  AnalyzedRoute,
  AnalyzedRouteParameter,
} from "./controller-routes.types.ts";
import type {
  ControllerImportSpecifiers,
  ControllerInvokerProvenance,
  DeclinedControllerHandler,
  EmittedControllerInvokers,
  EmittableRouteParameter,
} from "./controller-invokers.types.ts";

/**
 * The package a class token is named by.
 *
 * A generated module imports the type rather than restating the shape, exactly
 * as the descriptor emitter names the helpers it calls from the package that
 * declares them. The application already depends on `@aponiajs/common` for its
 * decorators, so this adds no dependency a generated project does not have.
 */
const aponiaModuleSpecifier = "@aponiajs/common";

/**
 * Emits a module whose route invokers are literal source.
 *
 * The runtime otherwise builds each invoker with `new Function` and infers a
 * handler's bindings from its source. Generating them at build time removes
 * both from the request path.
 *
 * The emitter covers what it can prove and declines the rest rather than
 * emitting something it cannot type: every declined handler stays on the
 * runtime's existing compile path, so a partially generated application is a
 * supported state, not a broken one.
 *
 * `provenance` names the release and Elysia the module was built against. The
 * platform refuses an artifact whose framework version is not the one running,
 * so this travels with the invokers rather than being left to the application to
 * keep in step.
 */
export function emitControllerInvokers(
  controllers: readonly AnalyzedController[],
  imports: ControllerImportSpecifiers,
  provenance: ControllerInvokerProvenance,
): EmittedControllerInvokers {
  const declined: DeclinedControllerHandler[] = [];
  const emitted: RenderedController[] = [];

  for (const controller of controllers) {
    const specifier = imports[controller.className];
    if (specifier === undefined) {
      for (const route of controller.routes) {
        declined.push(
          decline(controller, route, "no import specifier was supplied for the controller class"),
        );
      }
      continue;
    }

    const handlers = new Map<string, AnalyzedRoute>();
    for (const route of controller.routes) {
      if (!handlers.has(route.methodName)) {
        handlers.set(route.methodName, route);
      }
    }

    const bodies: string[] = [];
    for (const [methodName, route] of handlers) {
      const reason = declineReason(route);
      if (reason !== undefined) {
        declined.push(decline(controller, route, reason));
        continue;
      }

      bodies.push(renderHandler(controller, methodName, route));
    }

    emitted.push({
      controller,
      specifier,
      source: renderController(controller, bodies),
    });
  }

  const withHandlers = emitted.filter((entry) => entry.source.length > 0);
  return Object.freeze({
    source: withHandlers.length === 0 ? undefined : renderModule(withHandlers, provenance),
    declined: Object.freeze(declined),
  });
}

/**
 * Why a handler cannot be generated for, or `undefined` when it can.
 *
 * A handler with no decorated parameter is declined because the runtime's rule
 * for an undecorated handler — one declared parameter receives the whole
 * context — is decided while mounting, from decorator metadata and the
 * handler's own source. Source analysis cannot reproduce that decision, and
 * guessing wrong would silently change what a handler receives.
 */
function declineReason(route: AnalyzedRoute): string | undefined {
  if (route.parameters.length > 0) {
    const wholeContext = route.parameters.some((parameter) => parameter.kind === "context");
    return wholeContext
      ? "the handler takes the whole context through a decorator, whose type this package cannot name"
      : undefined;
  }

  if (!route.declaresParameters && route.usesArgumentsObject) {
    return "the handler declares no parameter but reads `arguments`, so the runtime decides what it receives";
  }

  return undefined;
}

function decline(
  controller: AnalyzedController,
  route: AnalyzedRoute,
  reason: string,
): DeclinedControllerHandler {
  return Object.freeze({
    controller: controller.className,
    method: route.methodName,
    reason,
  });
}

function renderController(controller: AnalyzedController, bodies: readonly string[]): string {
  if (bodies.length === 0) {
    return "";
  }

  return [
    `  [`,
    `    ${controller.className},`,
    `    (instance: ${controller.className}) =>`,
    `      new Map<string | symbol, RouteInvoker>([`,
    bodies.join(handlerSeparator),
    `      ]),`,
    `  ],`,
  ].join("\n");
}

/** Each rendered handler already ends with its own separator. */
const handlerSeparator = "\n";

function renderHandler(
  controller: AnalyzedController,
  methodName: string,
  route: AnalyzedRoute,
): string {
  const { contextParameter, argumentList } = renderCall(controller, methodName, route);

  return [
    `        [`,
    `          ${JSON.stringify(methodName)},`,
    `          ${contextParameter} => {`,
    `            const result = instance.${methodName}(${argumentList});`,
    `            return result;`,
    `          },`,
    `        ],`,
  ].join("\n");
}

/**
 * The invoker's parameter and the arguments the handler receives.
 *
 * A handler with no decorated parameter takes either the whole context or
 * nothing, and which one is the runtime's rule: a handler that declares a
 * parameter receives the context. Reproducing it here is what lets the emitter
 * cover the ordinary `findAll(): Item[]` shape instead of leaving it to be
 * compiled, and `declaresParameters` is the analysis reporting the one fact
 * that decision needs.
 */
function renderCall(
  controller: AnalyzedController,
  methodName: string,
  route: AnalyzedRoute,
): { readonly contextParameter: string; readonly argumentList: string } {
  if (route.parameters.length === 0) {
    const firstParameter = `Parameters<${controller.className}[${JSON.stringify(methodName)}]>[0]`;

    return route.declaresParameters
      ? { contextParameter: `(context: ${firstParameter})`, argumentList: "context" }
      : { contextParameter: "()", argumentList: "" };
  }

  const parameters = route.parameters as readonly EmittableRouteParameter[];

  return {
    contextParameter: `(context: ${renderContextType(controller.className, methodName, parameters)})`,
    argumentList: renderArguments(controller.className, methodName, parameters),
  };
}

/**
 * The invoker's context parameter, built from the application's own parameter
 * annotations. `Parameters<Controller["method"]>[index]` is resolved by the
 * type checker rather than by source text, so aliases, unions, and generics
 * follow for free and no cast is needed.
 */
function renderContextType(
  className: string,
  methodName: string,
  parameters: readonly EmittableRouteParameter[],
): string {
  const fields = parameters.map((parameter) => {
    const value = `Parameters<${className}[${JSON.stringify(methodName)}]>[${parameter.index}]`;
    if (parameter.property === undefined) {
      return `readonly ${parameter.kind}: ${value}`;
    }
    if (parameter.kind === "cookie") {
      return `readonly ${parameter.kind}: Readonly<Record<string, { readonly value: ${value} }>>`;
    }

    return `readonly ${parameter.kind}: Readonly<Record<string, ${value}>>`;
  });

  return `{ ${fields.join("; ")} }`;
}

/**
 * The arguments the handler receives, one per declared parameter.
 *
 * Every argument is asserted to the type the application annotated that
 * parameter with. Two of the readings a compiled invoker produces cannot be
 * typed as what the annotation declares: a property read is guarded against a
 * context field that is not an object, which leaves `undefined` in the
 * alternative, and a parameter no decorator named is passed `undefined`. Both
 * are what the platform's own binding passes, so the annotation is the
 * application's promise about its own handler rather than something this
 * emitter can prove — which is exactly why the assertion is written here, once,
 * instead of the annotation being narrowed to match.
 */
function renderArguments(
  className: string,
  methodName: string,
  parameters: readonly EmittableRouteParameter[],
): string {
  const parameterType = (index: number): string =>
    `Parameters<${className}[${JSON.stringify(methodName)}]>[${index}]`;
  const highestIndex = parameters.reduce(
    (highest, parameter) => Math.max(highest, parameter.index),
    -1,
  );
  const arguments_ = Array.from(
    { length: highestIndex + 1 },
    (_argument, index) => `undefined as ${parameterType(index)}`,
  );
  for (const parameter of parameters) {
    arguments_[parameter.index] =
      `(${parameterExpression(parameter)}) as ${parameterType(parameter.index)}`;
  }

  return arguments_.join(", ");
}

/**
 * Mirrors `parameterExpression` in
 * `packages/platform-elysia/src/routing/route-compiler.ts`. A generated read has
 * to produce the same value the compiled one does, including the optional
 * cookie guard, so the two paths stay interchangeable.
 */
function parameterExpression(parameter: AnalyzedRouteParameter): string {
  const source = contextSource(parameter);
  if (parameter.property === undefined) {
    return source;
  }

  const property = JSON.stringify(parameter.property);
  const value = `${source}[${property}]`;
  const selected = parameter.kind === "cookie" ? `${value}?.value` : value;

  return `(typeof ${source}==="object"&&${source}!==null?${selected}:undefined)`;
}

function contextSource(parameter: AnalyzedRouteParameter): string {
  switch (parameter.kind) {
    case "set":
      return "context.set";
    case "request":
      return "context.request";
    default:
      return `context.${parameter.kind}`;
  }
}

interface RenderedController {
  readonly controller: AnalyzedController;
  readonly specifier: string;
  readonly source: string;
}

function renderModule(
  entries: readonly RenderedController[],
  provenance: ControllerInvokerProvenance,
): string {
  // A value import, not `import type`: the controller class is the map's key at
  // runtime, and the analysis is only safe because the same class is the one the
  // application registers.
  const imports = entries
    .map(
      (entry) =>
        `import { ${entry.controller.className} } from ${JSON.stringify(entry.specifier)};`,
    )
    .join("\n");
  const body = entries.map((entry) => entry.source).join("\n");

  return [
    "// Generated by @aponiajs/cli. Do not edit.",
    // The map's key is a class constructor, and the platform names that shape.
    // A type import, so a generated module adds no runtime dependency it did
    // not already have: the application imports `@aponiajs/common` for its own
    // decorators.
    `import type { ClassToken } from ${JSON.stringify(aponiaModuleSpecifier)};`,
    imports,
    "",
    "type RouteInvoker = (context: never) => unknown;",
    "",
    "/**",
    " * Route invokers the runtime uses instead of compiling its own. A handler",
    " * with no entry here is compiled as usual.",
    " */",
    "const controllerInvokers = new Map<",
    "  ClassToken<unknown>,",
    "  (instance: never) => ReadonlyMap<string | symbol, RouteInvoker>",
    ">([",
    body,
    "]);",
    "",
    "/**",
    " * What the platform consumes. An artifact from another AponiaJS release is",
    " * refused whole and every route is compiled from decorator metadata instead,",
    " * so a stale file is never used to serve a request.",
    " *",
    " * `elysia` is the version this file was generated against, or `null` when",
    " * `aponia build` could not resolve an installed one. It is reported with the",
    " * refusal so a mismatch names both sides.",
    " */",
    "export const controllerInvokerArtifact = Object.freeze({",
    `  framework: ${JSON.stringify(provenance.framework)},`,
    `  elysia: ${JSON.stringify(provenance.elysia)},`,
    "  invokers: controllerInvokers,",
    "});",
    "",
  ].join("\n");
}
