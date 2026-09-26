import type { LoggerService, Provider, RequestMethod, RouteParameterKind } from "@aponiajs/common";
import type { AponiaApplicationOptions } from "../application/application.types.ts";

/**
 * Options for {@link inspectAponiaApplication}.
 *
 * The artifact options are the ones an application passes to the factory, so an
 * inspection can be handed the pair `aponia build` wrote. Only `descriptors` is
 * resolved, through the same selector bootstrap uses, because that artifact
 * declares the module graph: an inspection has to describe the graph the
 * application boots from however that graph was chosen. `invokers` is accepted
 * so the two option shapes stay interchangeable — an invoker artifact binds
 * handlers rather than declaring the graph, so it changes nothing the projection
 * reports.
 *
 * A `logger` receives the line the selector reports whichever way it decided,
 * which is the line bootstrap would log for the same artifact.
 */
export type AponiaInspectionOptions = Readonly<
  Pick<AponiaApplicationOptions, "invokers" | "descriptors">
> & {
  readonly logger?: LoggerService;
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
