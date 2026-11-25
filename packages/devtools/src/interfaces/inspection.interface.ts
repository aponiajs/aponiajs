import type { Provider, RequestMethod, RouteParameterKind } from "@aponiajs/common";

/** The declared kind of a provider in a compiled module graph. */
export type DevtoolsProviderKind = Provider["kind"];

/** One provider declared by a module, described by names only. */
export interface DevtoolsProviderInspection {
  readonly token: string;
  readonly kind: DevtoolsProviderKind;
  readonly dependencies: readonly string[];
  readonly scope?: "singleton" | "request" | "transient";
}

/** One module of the compiled graph. */
export interface DevtoolsModuleInspection {
  readonly id: string;
  readonly instanceId: string | undefined;
  readonly imports: readonly string[];
  readonly controllers: readonly string[];
  readonly providers: readonly DevtoolsProviderInspection[];
  readonly exports: readonly string[];
}

/** One request parameter a route handler binds. */
export interface DevtoolsRouteParameterInspection {
  readonly index: number;
  readonly kind: RouteParameterKind;
  readonly property: string | undefined;
}

/** One mounted HTTP route. */
export interface DevtoolsRouteInspection {
  readonly method: RequestMethod;
  readonly path: string;
  readonly module: string;
  readonly controller: string;
  readonly handler: string;
  readonly parameters: readonly DevtoolsRouteParameterInspection[];
}

/** One registered WebSocket gateway. */
export interface DevtoolsGatewayInspection {
  readonly module: string;
  readonly token: string;
  readonly path: string;
  readonly events: readonly string[];
}

/** A frozen projection of a compiled application, from the neutral boot record. */
export interface DevtoolsInspection {
  readonly rootModule: string;
  readonly modules: readonly DevtoolsModuleInspection[];
  readonly routes: readonly DevtoolsRouteInspection[];
  readonly gateways: readonly DevtoolsGatewayInspection[];
  readonly invokers: { readonly accepted: boolean; readonly reason: string | undefined };
  readonly artifacts: { readonly invokers: string | null; readonly descriptors: string | null };
}
