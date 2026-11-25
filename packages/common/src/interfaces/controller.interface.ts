import type { ProviderScope } from "./provider.interface.ts";
import type { Constructor, InjectionDependency, Token } from "./token.interface.ts";

/** A lowered controller: the descriptor the platform mounts. */
export interface ControllerDefinition {
  /** The controller kind the platform dispatches on. */
  readonly kind: string;
  /** The token the container instantiates the controller through. */
  readonly token: Token<unknown>;
  /** The dependency list the construction resolves. */
  readonly inject: readonly InjectionDependency[];
  /** The controller class to construct. */
  readonly useClass: Constructor<unknown, never[]>;
  /**
   * The declared lifetime. `Scope.REQUEST` constructs one controller per
   * request, and a controller whose dependencies reach a request-scoped
   * provider is request-scoped whatever it declares.
   */
  readonly scope?: ProviderScope;
  /**
   * Groups a request-scoped controller by the parent context id a registered
   * `ContextIdStrategy` resolves. Only meaningful with `Scope.REQUEST`.
   */
  readonly durable?: boolean;
}
