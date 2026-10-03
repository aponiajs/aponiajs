import type { Constructor, Token } from "../tokens/token.types.ts";

/** A lowered controller: the descriptor the platform mounts. */
export interface ControllerDefinition {
  /** The controller kind the platform dispatches on. */
  readonly kind: string;
  /** The token the container instantiates the controller through. */
  readonly token: Token<unknown>;
  /** The dependency list the construction resolves. */
  readonly inject: readonly Token<unknown>[];
  /** The controller class to construct. */
  readonly useClass: Constructor<unknown, never[]>;
}
