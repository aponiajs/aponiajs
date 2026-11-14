import type { ClassToken } from "../tokens/token.types.ts";

/**
 * The HTTP argument category a parameter belongs to.
 */
export type ArgumentType = "body" | "query" | "param" | "headers" | "cookie" | "custom";

/**
 * Metadata passed to a pipe describing the parameter being transformed or validated.
 */
export interface ArgumentMetadata {
  /** The argument category (body, query, param, headers, cookie, or custom). */
  readonly type: ArgumentType;
  /** The constructor of the parameter type, if recorded. */
  readonly metatype?: ClassToken<unknown>;
  /** The property name specified in the parameter decorator, if any. */
  readonly data?: string;
}

/**
 * Contract for parameter and payload transformation and validation pipes.
 */
export interface PipeTransform<TInput = unknown, TOutput = unknown> {
  /**
   * Transforms or validates the incoming value.
   *
   * @param value - The parameter value to transform or validate.
   * @param metadata - Metadata describing the argument location and type.
   * @returns The transformed value, or a promise resolving to it.
   */
  transform(value: TInput, metadata: ArgumentMetadata): TOutput | Promise<TOutput>;
}

/**
 * A pipe instance or pipe constructor.
 */
export type PipeType = PipeTransform<any, any> | ClassToken<PipeTransform<any, any>>;
