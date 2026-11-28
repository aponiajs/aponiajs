import type {
  ClassToken,
  McpPrimitiveMetadata,
  ModuleDefinition,
  PipeType,
} from "@aponiajs/common";

/** One decorated method, resolved and ready to invoke. */
export interface McpPrimitivePlan {
  readonly kind: "tool" | "resource" | "resourceTemplate" | "prompt";
  /** The tool or prompt name, or the resource URI. */
  readonly name: string;
  readonly metadata: McpPrimitiveMetadata;
  readonly instance: object;
  readonly classToken: ClassToken<unknown>;
  readonly methodName: string | symbol;
  readonly handler: (...arguments_: unknown[]) => unknown;
  readonly metatype: unknown;
  readonly module: ModuleDefinition;
  readonly guards: readonly ClassToken<unknown>[];
  readonly interceptors: readonly ClassToken<unknown>[];
  readonly filters: readonly ClassToken<unknown>[];
  readonly pipes: readonly PipeType[];
}

/** Everything one boot found, frozen and keyed by the protocol's own names. */
export interface McpPlan {
  readonly tools: readonly McpPrimitivePlan[];
  readonly resources: readonly McpPrimitivePlan[];
  readonly resourceTemplates: readonly McpPrimitivePlan[];
  readonly prompts: readonly McpPrimitivePlan[];
}
