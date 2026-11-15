import { Injectable } from "../decorators/decorators.ts";
import { getCustomMetadata } from "./metadata.ts";

/**
 * Service providing metadata retrieval helpers across controller classes and handler methods.
 */
@Injectable()
export class Reflector {
  /**
   * Retrieves metadata value assigned to a class or handler target.
   *
   * @param metadataKey - The metadata key.
   * @param target - The method function or class constructor.
   * @returns The metadata value or undefined.
   */
  get<T = unknown>(metadataKey: unknown, target: object): T | undefined {
    return getCustomMetadata<T>(metadataKey, target);
  }

  /**
   * Retrieves metadata across a list of targets (typically [handler, class]), returning the first defined value.
   *
   * @param metadataKey - The metadata key.
   * @param targets - The targets in evaluation order (most specific first).
   * @returns The first defined metadata value or undefined.
   */
  getAllAndOverride<T = unknown>(
    metadataKey: unknown,
    targets: readonly (object | undefined)[],
  ): T | undefined {
    for (const target of targets) {
      if (target === undefined) {
        continue;
      }
      const value = this.get<T>(metadataKey, target);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Retrieves and merges array metadata across multiple targets.
   *
   * @param metadataKey - The metadata key.
   * @param targets - The targets in evaluation order.
   * @returns The merged array of metadata items.
   */
  getAllAndMerge<T extends readonly unknown[] = readonly unknown[]>(
    metadataKey: unknown,
    targets: readonly (object | undefined)[],
  ): T {
    const result: unknown[] = [];
    for (const target of targets) {
      if (target === undefined) {
        continue;
      }
      const value = this.get<unknown>(metadataKey, target);
      if (Array.isArray(value)) {
        result.push(...value);
      } else if (value !== undefined) {
        result.push(value);
      }
    }
    return result as unknown as T;
  }
}
