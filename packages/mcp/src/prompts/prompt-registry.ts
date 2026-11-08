import type { McpPromptDefinition, McpPromptDescriptor } from "./prompt.types.ts";

/** Registry maintaining the prompts one server publishes. */
export class McpPromptRegistry {
  readonly #prompts = new Map<string, McpPromptDefinition>();

  register(prompt: McpPromptDefinition): void {
    this.#prompts.set(prompt.name, prompt);
  }

  unregister(name: string): boolean {
    return this.#prompts.delete(name);
  }

  get(name: string): McpPromptDefinition | undefined {
    return this.#prompts.get(name);
  }

  list(): readonly McpPromptDescriptor[] {
    return Array.from(this.#prompts.values()).map((prompt) =>
      Object.freeze({
        name: prompt.name,
        ...(prompt.description === undefined ? {} : { description: prompt.description }),
        ...(prompt.arguments === undefined
          ? {}
          : {
              arguments: Object.freeze(
                prompt.arguments.map((argument) => Object.freeze({ ...argument })),
              ),
            }),
      }),
    );
  }

  get size(): number {
    return this.#prompts.size;
  }
}

/** Freezes one prompt declaration. */
export function defineMcpPrompt(prompt: McpPromptDefinition): McpPromptDefinition {
  if (typeof prompt.name !== "string" || prompt.name.trim() === "") {
    throw new TypeError("An MCP prompt needs a non-empty name.");
  }
  if (typeof prompt.get !== "function") {
    throw new TypeError("An MCP prompt needs a get function.");
  }
  return Object.freeze({
    ...prompt,
    ...(prompt.arguments === undefined
      ? {}
      : {
          arguments: Object.freeze(
            prompt.arguments.map((argument) => Object.freeze({ ...argument })),
          ),
        }),
  });
}
