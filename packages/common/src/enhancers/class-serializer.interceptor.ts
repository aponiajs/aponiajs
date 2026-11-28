import type { ExecutionContext, Interceptor } from "../interfaces/enhancer.interface.ts";
import type { SerializeOptions } from "../routing/serialize-options.ts";
import { getSerializeOptions } from "../routing/serialize-options.ts";
import { StreamableFile } from "../routing/streamable-file.ts";

/**
 * Projects a handler's response through the `@SerializeOptions()` a route
 * declares.
 *
 * Nest's interceptor calls class-transformer's `instanceToPlain`. AponiaJS
 * carries no class-transformer dependency, so the projection states what the
 * options mean without one: `excludePrefixes` drops matching keys, and
 * `excludeExtraneousValues` keeps the value's own enumerable properties. A
 * `StreamableFile` is returned untouched, exactly as Nest's interceptor leaves
 * it.
 */
export class ClassSerializerInterceptor implements Interceptor {
  readonly #options: SerializeOptions;

  /**
   * @param options - Options applied when the route declares none.
   */
  constructor(options: SerializeOptions = {}) {
    this.#options = Object.freeze({ ...options });
  }

  interceptAfter(context: ExecutionContext, response: unknown): unknown {
    if (response instanceof StreamableFile) {
      return response;
    }
    const declared =
      getSerializeOptions(context.getHandler() as object) ??
      getSerializeOptions(context.getClass() as unknown as object);
    return serializeValue(response, { ...this.#options, ...declared });
  }
}

/** Projects one response value and every nested plain object it carries. */
function serializeValue(value: unknown, options: SerializeOptions): unknown {
  if (value === null || typeof value !== "object" || value instanceof StreamableFile) {
    return value;
  }
  if (value instanceof Date || value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry, options));
  }

  const prefixes = options.excludePrefixes ?? [];
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    projected[key] = serializeValue(entry, options);
  }
  return projected;
}
