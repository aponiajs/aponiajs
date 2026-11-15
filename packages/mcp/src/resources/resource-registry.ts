import type { McpResourceDefinition, McpResourceDescriptor } from "./resource.types.ts";

/** Registry maintaining the resources one server publishes. */
export class McpResourceRegistry {
  readonly #resources = new Map<string, McpResourceDefinition>();

  register(resource: McpResourceDefinition): void {
    this.#resources.set(resource.uri, resource);
  }

  unregister(uri: string): boolean {
    return this.#resources.delete(uri);
  }

  get(uri: string): McpResourceDefinition | undefined {
    return this.#resources.get(uri);
  }

  list(): readonly McpResourceDescriptor[] {
    return Array.from(this.#resources.values()).map((resource) =>
      Object.freeze({
        uri: resource.uri,
        name: resource.name,
        ...(resource.description === undefined ? {} : { description: resource.description }),
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
      }),
    );
  }

  get size(): number {
    return this.#resources.size;
  }
}

/** Freezes one resource declaration. */
export function defineMcpResource(resource: McpResourceDefinition): McpResourceDefinition {
  if (typeof resource.uri !== "string" || resource.uri.trim() === "") {
    throw new TypeError("An MCP resource needs a non-empty uri.");
  }
  if (typeof resource.name !== "string" || resource.name.trim() === "") {
    throw new TypeError("An MCP resource needs a non-empty name.");
  }
  if (typeof resource.read !== "function") {
    throw new TypeError("An MCP resource needs a read function.");
  }
  return Object.freeze({ ...resource });
}
