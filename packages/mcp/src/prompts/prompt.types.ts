import type { McpPromptMessage } from "../protocol/protocol.types.ts";

/** One argument a prompt accepts. */
export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

/** Declaration of one MCP prompt. */
export interface McpPromptDefinition {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly McpPromptArgument[];
  /** Builds the prompt messages for `prompts/get`. */
  get(
    arguments_: Readonly<Record<string, string>>,
  ):
    | { readonly description?: string; readonly messages: readonly McpPromptMessage[] }
    | Promise<{ readonly description?: string; readonly messages: readonly McpPromptMessage[] }>;
}

/** Wire representation of a prompt returned in `prompts/list`. */
export interface McpPromptDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly McpPromptArgument[];
}
