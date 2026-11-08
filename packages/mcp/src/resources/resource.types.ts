import type { McpResourceContent } from "../protocol/protocol.types.ts";

/** Declaration of one MCP resource. */
export interface McpResourceDefinition {
  /** The URI the resource is read by. */
  readonly uri: string;
  /** A short human-readable name. */
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  /** Answers the resource's contents for `resources/read`. */
  read(): readonly McpResourceContent[] | Promise<readonly McpResourceContent[]>;
}

/** Wire representation of a resource returned in `resources/list`. */
export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}
