import { mcpPrimitivesMetadataKey } from "./mcp-metadata.ts";
import type {
  McpPrimitiveMetadata,
  McpPromptOptions,
  McpResourceOptions,
  McpResourceTemplateOptions,
  McpToolOptions,
} from "./mcp.types.ts";

const primitiveNamePattern = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Declares a method a Model Context Protocol client calls as a tool.
 *
 * @param options - The tool's name, description, and schemas.
 * @returns The method decorator recording the tool.
 *
 * @example
 * ```ts
 * @Tool({ inputSchema: z.object({ orderId: z.string() }) })
 * findOrder({ orderId }: { orderId: string }, ctx: McpContext) {}
 * ```
 */
export function Tool(options: McpToolOptions = {}): MethodDecorator {
  return recordPrimitive({
    kind: "tool",
    ...copyOptions(options),
    ...(options.inputSchema === undefined ? {} : { inputSchema: options.inputSchema }),
    ...(options.outputSchema === undefined ? {} : { outputSchema: options.outputSchema }),
  });
}

/**
 * Declares a method that answers one fixed URI as a resource.
 *
 * @param options - The URI, media type, and display metadata.
 * @returns The method decorator recording the resource.
 */
export function Resource(options: McpResourceOptions): MethodDecorator {
  if (typeof options.uri !== "string" || options.uri.length === 0) {
    throw new TypeError("@Resource needs a non-empty uri.");
  }

  return recordPrimitive({
    kind: "resource",
    ...copyOptions(options),
    uri: options.uri,
    ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
    ...(options.size === undefined ? {} : { size: options.size }),
  });
}

/**
 * Declares a method that answers every URI an RFC 6570 template matches.
 *
 * @param options - The template and display metadata.
 * @returns The method decorator recording the resource template.
 */
export function ResourceTemplate(options: McpResourceTemplateOptions): MethodDecorator {
  if (typeof options.uriTemplate !== "string" || options.uriTemplate.length === 0) {
    throw new TypeError("@ResourceTemplate needs a non-empty uriTemplate.");
  }

  return recordPrimitive({
    kind: "resourceTemplate",
    ...copyOptions(options),
    uriTemplate: options.uriTemplate,
    ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
    ...(options.size === undefined ? {} : { size: options.size }),
  });
}

/**
 * Declares a method a client fills with arguments and sends to the model.
 *
 * @param options - The prompt's name, description, and argument schema.
 * @returns The method decorator recording the prompt.
 */
export function Prompt(options: McpPromptOptions = {}): MethodDecorator {
  return recordPrimitive({
    kind: "prompt",
    ...copyOptions(options),
    ...(options.argsSchema === undefined ? {} : { argsSchema: options.argsSchema }),
  });
}

function copyOptions(options: McpPrimitiveOptionsSource): Omit<McpPrimitiveMetadata, "kind"> {
  if (options.name !== undefined && !primitiveNamePattern.test(options.name)) {
    throw new TypeError(
      `MCP primitive name "${options.name}" must be 1-128 characters of A-Z a-z 0-9 _ - .`,
    );
  }

  return {
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.annotations === undefined
      ? {}
      : { annotations: Object.freeze({ ...options.annotations }) }),
    ...(options.icons === undefined ? {} : { icons: Object.freeze([...options.icons]) }),
    ...(options._meta === undefined ? {} : { meta: Object.freeze({ ...options._meta }) }),
  };
}

interface McpPrimitiveOptionsSource {
  readonly name?: string;
  readonly title?: string;
  readonly description?: string;
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly icons?: readonly Readonly<Record<string, unknown>>[];
  readonly _meta?: Readonly<Record<string, unknown>>;
}

function recordPrimitive(metadata: McpPrimitiveMetadata): MethodDecorator {
  const frozen = Object.freeze(metadata);

  return (target: object, propertyKey: string | symbol): void => {
    const recorded =
      (Reflect.getMetadata(mcpPrimitivesMetadataKey, target) as
        | Map<string | symbol, McpPrimitiveMetadata>
        | undefined) ?? new Map<string | symbol, McpPrimitiveMetadata>();
    const next = new Map(recorded);
    next.set(propertyKey, frozen);
    Reflect.defineMetadata(mcpPrimitivesMetadataKey, next, target);
  };
}
