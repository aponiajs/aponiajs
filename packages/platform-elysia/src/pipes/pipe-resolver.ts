import {
  APP_PIPE,
  AponiaError,
  type ApplicationEnhancer,
  type ApplicationEnhancerBinding,
  type ArgumentMetadata,
  type PipeTransform,
  type PipeType,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { ResolvedPipe } from "./pipe-resolver.types.ts";

export type { ResolvedPipe } from "./pipe-resolver.types.ts";

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
export function resolveApplicationPipe(pipe: PipeType, container: AponiaContainer): ResolvedPipe {
  if (typeof pipe !== "function") {
    return resolvePipe(pipe, container);
  }

  const instance = container.get(pipe);
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
 * Each entry is a pipe instance or a class, resolved the way a pipe named by a
 * decorator is. A token no module provides resolves to nothing.
 *
 * @param container - The booted container whose root module declares the token.
 * @returns The resolved pipes, in declaration order.
 *
 * @internal
 */
export function resolveApplicationPipes(container: AponiaContainer): readonly ResolvedPipe[] {
  const module = container.graph.root;
  try {
    container.graph.locate(module, APP_PIPE);
  } catch (error) {
    if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
      return Object.freeze([]);
    }
    throw error;
  }

  const value = container.resolveModuleProvider(module, APP_PIPE) as
    | ApplicationEnhancerBinding<PipeTransform>
    | undefined;
  if (value === undefined) {
    return Object.freeze([]);
  }

  const entries = Array.isArray(value) ? value : [value];
  return Object.freeze(
    (entries as readonly ApplicationEnhancer<PipeTransform>[]).map((entry) =>
      resolveApplicationPipe(entry as PipeType, container),
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
