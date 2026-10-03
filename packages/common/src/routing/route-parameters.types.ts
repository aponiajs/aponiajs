import type { routeParameterKinds } from "./route-parameters.ts";

/** The request piece a handler parameter binds to. */
export type RouteParameterKind = (typeof routeParameterKinds)[number];

/** One compiled handler parameter: its position, its kind, and its named property. */
export interface RouteParameterMetadata {
  /** The zero-based parameter position. */
  readonly index: number;
  /** The request piece this parameter reads. */
  readonly kind: RouteParameterKind;
  /** The named property to read, or the whole piece when `undefined`. */
  readonly property: string | undefined;
}
