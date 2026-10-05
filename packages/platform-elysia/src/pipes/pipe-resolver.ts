import {
  AponiaError,
  type ArgumentMetadata,
  type PipeTransform,
  type PipeType,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { ResolvedPipe } from "./pipe-resolver.types.ts";

export type { ResolvedPipe } from "./pipe-resolver.types.ts";

/**
 * Resolves a pipe instance from a class constructor or existing instance.
 *
 * @param pipe - The pipe class or instance.
 * @param container - Optional container to resolve dependencies.
 * @returns The resolved pipe structure.
 */
export function resolvePipe(pipe: PipeType, container?: AponiaContainer): ResolvedPipe {
  if (typeof pipe === "function") {
    if (container) {
      try {
        const instance = container.get(pipe);
        if (
          typeof instance === "object" &&
          instance !== null &&
          typeof (instance as { transform?: unknown }).transform === "function"
        ) {
          return Object.freeze({ instance: instance as PipeTransform });
        }
      } catch {
        // Fall back to direct instantiation
      }
    }

    try {
      const instance = Reflect.construct(pipe, []) as PipeTransform;
      return Object.freeze({ instance });
    } catch {
      throw new AponiaError(
        "INVALID_PIPE",
        `Could not instantiate pipe class "${pipe.name}". Ensure its constructor takes no arguments or is registered in a module.`,
        { pipe: pipe.name },
      );
    }
  }

  if (
    typeof pipe === "object" &&
    pipe !== null &&
    typeof (pipe as { transform?: unknown }).transform === "function"
  ) {
    return Object.freeze({ instance: pipe });
  }

  throw new AponiaError("INVALID_PIPE", "Provided pipe value does not implement PipeTransform.");
}

/**
 * Executes a pipeline of pipes sequentially over an argument value.
 *
 * @param pipes - The sequence of resolved pipes to execute.
 * @param initialValue - The incoming argument value.
 * @param metadata - Argument location and type metadata.
 * @returns The transformed output.
 */
export async function executePipes(
  pipes: readonly ResolvedPipe[],
  initialValue: unknown,
  metadata: ArgumentMetadata,
): Promise<unknown> {
  let current = initialValue;
  for (const pipe of pipes) {
    current = await pipe.instance.transform(current, metadata);
  }
  return current;
}
