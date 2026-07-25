import type { Constructor, Token } from "./token.ts";

export interface ControllerDefinition {
  readonly kind: string;
  readonly token: Token<unknown>;
  readonly inject: readonly Token<unknown>[];
  readonly useClass: Constructor<unknown, never[]>;
}
