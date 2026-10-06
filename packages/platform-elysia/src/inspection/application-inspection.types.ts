import type { Provider, RequestMethod, RouteParameterKind } from "@aponiajs/common";
import type { AponiaApplicationOptions } from "../application/application.types.ts";

/**
 * Options for {@link inspectAponiaApplication}.
 *
 * `descriptors` is the artifact option an application passes to the factory, and
 * inspection resolves it through the same selector bootstrap uses, because that
 * artifact declares the module graph: an inspection has to describe the graph the
 * application boots from however that graph was chosen.
 *
 * `logger` takes the shapes the factory's own option takes, so an application can
 * forward its value unchanged. Omitting it and passing `false` both keep the
 * inspection silent, because inspection is a library call whose caller decides
 * what gets printed — a level list is the caller asking for the platform's
 * logger. Whichever way the artifact is decided, one line reports it.
 */
export type AponiaInspectionOptions = Readonly<Pick<AponiaApplicationOptions, "descriptors">> & {
  readonly logger?: AponiaApplicationOptions["logger"];
};

/**
 * The declared kind of a provider in a compiled module graph.
 */
export type AponiaInspectedProviderKind = Provider["kind"];

/**
 * One provider declared by a module, described by names only.
 */
export interface AponiaProviderInspection {
  readonly token: string;
  readonly kind: AponiaInspectedProviderKind;
  /**
   * Token names this provider depends on, derived exactly as the container
   * derives them: the aliased token for an alias, the injected tokens for a
   * class or factory, and nothing for a value.
   */
  readonly dependencies: readonly string[];
  /**
   * The configured lifecycle scope: "singleton", "request", or "transient",
   * or absent when using the default singleton lifetime.
   */
  readonly scope?: "singleton" | "request" | "transient";
}

/**
 * One module of the compiled graph. Modules appear in graph order, so every
 * import precedes the module that imports it.
 */
export interface AponiaModuleInspection {
  readonly id: string;
  /**
   * The configured instance identity of a dynamic module, projected with
   * `String(symbol)`. `undefined` for a statically declared module.
   */
  readonly instanceId: string | undefined;
  readonly imports: readonly string[];
  readonly controllers: readonly string[];
  readonly providers: readonly AponiaProviderInspection[];
  readonly exports: readonly string[];
}

/**
 * One request parameter a route handler binds through a parameter decorator.
 */
export interface AponiaRouteParameterInspection {
  readonly index: number;
  readonly kind: RouteParameterKind;
  readonly property: string | undefined;
}

/**
 * One mounted HTTP route. Routes are sorted by path, method, controller,
 * handler, and module so the order never depends on declaration order.
 */
export interface AponiaRouteInspection {
  readonly method: RequestMethod;
  readonly path: string;
  readonly module: string;
  readonly controller: string;
  /**
   * The handler's property key, projected with `String(key)`; a symbol key
   * therefore reads as `Symbol(description)`.
   */
  readonly handler: string;
  readonly parameters: readonly AponiaRouteParameterInspection[];
}

/**
 * One registered WebSocket gateway. Gateways are sorted by canonical path and
 * events keep their declared subscription order.
 */
export interface AponiaGatewayInspection {
  readonly module: string;
  readonly token: string;
  readonly path: string;
  readonly events: readonly string[];
}

/**
 * A frozen, JSON-serializable projection of a compiled Aponia application.
 */
export interface AponiaApplicationInspection {
  readonly rootModule: string;
  readonly modules: readonly AponiaModuleInspection[];
  readonly routes: readonly AponiaRouteInspection[];
  readonly gateways: readonly AponiaGatewayInspection[];
}
