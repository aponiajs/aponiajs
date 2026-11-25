import {
  AponiaError,
  type ArgumentMetadata,
  type PipeTransform,
  type PipeType,
  type ModuleDefinition,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { resolveApplicationPipeOccurrences } from "../application/application-enhancers.ts";
import type { ResolvedPipe } from "../interfaces/pipe-resolver.interface.ts";

export type { ResolvedPipe } from "../interfaces/pipe-resolver.interface.ts";

/**
 * Resolves one application-level pipe.
 *
 * The `pipes` option and `APP_PIPE` declare a transform for the whole
 * application, so a class must be a provider the root module can reach: a
 * missing provider is raised rather than falling back to constructing the class
 * with no dependencies, which `resolvePipe` does for a route-level pipe. An
 * instance is used as given.
 *
 * @param pipe - The pipe class or instance.
 * @param container - The booted container.
 * @returns The resolved pipe.
 * @throws An `AponiaError` with `MISSING_PROVIDER` or `INVALID_PIPE`.
 *
 * @internal
 */
export function resolveApplicationPipe(
  pipe: PipeType,
  container: AponiaContainer,
  module?: ModuleDefinition,
): ResolvedPipe {
  if (typeof pipe !== "function") {
    return resolvePipe(pipe, container);
  }

  const instance =
    module === undefined ? container.get(pipe) : container.resolveModuleProvider(module, pipe);
  if (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as { transform?: unknown }).transform === "function"
  ) {
    return Object.freeze({ instance: instance as PipeTransform });
  }

  throw new AponiaError(
    "INVALID_PIPE",
    `Application-level pipe "${pipe.name}" did not resolve to an implementation of PipeTransform.`,
    { pipe: pipe.name },
  );
}

/**
 * Resolves the pipes an application declares through the `APP_PIPE` token.
 *
 * Every registration of the token runs, in declaration order, and an array is
 * expanded where it was declared. Each class resolves in the module that
 * declared it; a class that module cannot reach raises `MISSING_PROVIDER`.
 *
 * @param container - The booted container whose modules declare the token.
 * @returns The resolved pipes, in declaration order.
 *
 * @internal
 */
export function resolveApplicationPipes(container: AponiaContainer): readonly ResolvedPipe[] {
  return Object.freeze(
    resolveApplicationPipeOccurrences(container).map((occurrence) =>
      resolveApplicationPipe(occurrence.entry as PipeType, container, occurrence.module),
    ),
  );
}

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

    if (pipe.length > 0) {
      throw new AponiaError(
        "INVALID_PIPE",
        `Pipe class "${pipe.name}" declares ${pipe.length} constructor parameter(s). A route-level pipe is constructed without dependency injection; pass an instance for a pipe with dependencies.`,
        { pipe: pipe.name },
      );
    }

    try {
      const instance = Reflect.construct(pipe, []) as PipeTransform;
      return Object.freeze({ instance });
    } catch {
      throw new AponiaError(
        "INVALID_PIPE",
        `Could not instantiate pipe class "${pipe.name}". A route-level pipe must have a constructor that takes no arguments.`,
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
 * Uses a sync fast-path when pipe transforms return synchronously.
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
  for (let i = 0; i < pipes.length; i++) {
    const result = pipes[i]!.instance.transform(current, metadata);
    current = typeof (result as Promise<unknown>)?.then === "function" ? await result : result;
  }
  return current;
}
