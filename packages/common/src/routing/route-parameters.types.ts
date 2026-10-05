import type { PipeType } from "../pipes/pipe.types.ts";
import type { routeParameterKinds } from "./route-parameters.ts";

/** The request piece a handler parameter binds to. */
export type RouteParameterKind = (typeof routeParameterKinds)[number];

/** One compiled handler parameter: its position, its kind, its named property, and any pipes. */
export interface RouteParameterMetadata {
  /** The zero-based parameter position. */
  readonly index: number;
  /** The request piece this parameter reads. */
  readonly kind: RouteParameterKind;
  /** The named property to read, or the whole piece when `undefined`. */
  readonly property: string | undefined;
  /** The pipes applied to this parameter, if any. */
  readonly pipes?: readonly PipeType[];
}
