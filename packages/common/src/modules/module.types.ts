import type { ControllerDefinition } from "../controllers/controller.types.ts";
import type { Provider } from "../providers/provider.types.ts";
import type { Token } from "../tokens/token.types.ts";

export interface ModuleDefinition {
  readonly id: string;
  readonly instanceId?: symbol;
  readonly imports: readonly ModuleDefinition[];
  readonly controllers: readonly ControllerDefinition[];
  readonly providers: readonly Provider[];
  readonly exports: readonly Token<unknown>[];
}

export interface ModuleOptions {
  readonly id: string;
  readonly instanceId?: symbol;
  readonly imports?: readonly ModuleDefinition[];
  readonly controllers?: readonly ControllerDefinition[];
  readonly providers?: readonly Provider[];
  readonly exports?: readonly Token<unknown>[];
}
