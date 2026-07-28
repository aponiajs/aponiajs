import type { routeParameterKinds } from "./route-parameters.ts";

export type RouteParameterKind = (typeof routeParameterKinds)[number];

export interface RouteParameterMetadata {
  readonly index: number;
  readonly kind: RouteParameterKind;
  readonly property: string | undefined;
}
