import type { StandardSchemaV1 } from "@standard-schema/spec";

/** The MCP primitive a decorated method declares. */
export type McpPrimitiveKind = "tool" | "resource" | "resourceTemplate" | "prompt";

/** What every MCP primitive decorator may state. */
export interface McpPrimitiveOptions {
  /** The name clients see; defaults to the method name. */
  readonly name?: string;
  /** The display title. */
  readonly title?: string;
  /** The description the model reads. */
  readonly description?: string;
  /** Behaviour hints for the client. */
  readonly annotations?: Readonly<Record<string, unknown>>;
  /** Icons the client may render. */
  readonly icons?: readonly Readonly<Record<string, unknown>>[];
  /** Vendor metadata carried beside the primitive. */
  readonly _meta?: Readonly<Record<string, unknown>>;
}

/** What `@Tool()` accepts. */
export interface McpToolOptions extends McpPrimitiveOptions {
  /** The schema the SDK validates arguments with. */
  readonly inputSchema?: StandardSchemaV1;
  /** The schema the SDK validates structured output with. */
  readonly outputSchema?: StandardSchemaV1;
}

/** What `@Resource()` accepts. */
export interface McpResourceOptions extends McpPrimitiveOptions {
  /** The fixed URI the resource answers. */
  readonly uri: string;
  /** The media type the resource answers. */
  readonly mimeType?: string;
  /** The byte size the client may show. */
  readonly size?: number;
}

/** What `@ResourceTemplate()` accepts. */
export interface McpResourceTemplateOptions extends McpPrimitiveOptions {
  /** The RFC 6570 template the resource answers. */
  readonly uriTemplate: string;
  /** The media type the resource answers. */
  readonly mimeType?: string;
  /** The byte size the client may show. */
  readonly size?: number;
}

/** What `@Prompt()` accepts. */
export interface McpPromptOptions extends McpPrimitiveOptions {
  /** The schema the SDK validates prompt arguments with. */
  readonly argsSchema?: StandardSchemaV1;
}

/** The metadata one decorated method carries. */
export interface McpPrimitiveMetadata {
  readonly kind: McpPrimitiveKind;
  readonly name?: string;
  readonly title?: string;
  readonly description?: string;
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly icons?: readonly Readonly<Record<string, unknown>>[];
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly inputSchema?: StandardSchemaV1;
  readonly outputSchema?: StandardSchemaV1;
  readonly argsSchema?: StandardSchemaV1;
  readonly uri?: string;
  readonly uriTemplate?: string;
  readonly mimeType?: string;
  readonly size?: number;
}
