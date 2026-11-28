import { provideFactory } from "@aponiajs/common";
import { getConfigToken } from "../config.constants.ts";
import type {
  ConfigFactory,
  ConfigFactoryKeyHost,
  ConfigObject,
} from "../interfaces/config-module.interface.ts";

/** Internal symbol storing the namespace key on a `registerAs` factory. */
export const NAMESPACE_KEY_METADATA = Symbol.for("aponia.config.namespace-key");

/**
 * Registers a namespaced configuration factory under `CONFIGURATION(<namespace>)`.
 *
 * @param namespace - Unique namespace key (e.g. `"database"`).
 * @param factory - Synchronous or asynchronous factory producing the namespace config.
 * @returns The factory augmented with `.KEY` and `.asProvider()`.
 */
export function registerAs<TConfig extends ConfigObject>(
  namespace: string,
  factory: ConfigFactory<TConfig>,
): ConfigFactory<TConfig> & ConfigFactoryKeyHost<TConfig> {
  const token = getConfigToken(namespace);
  const wrapped = (() => factory()) as ConfigFactory<TConfig> & ConfigFactoryKeyHost<TConfig>;

  Object.defineProperty(wrapped, "KEY", {
    value: token,
    writable: false,
    enumerable: true,
  });
  Object.defineProperty(wrapped, NAMESPACE_KEY_METADATA, {
    value: namespace,
    writable: false,
    enumerable: false,
  });
  Object.defineProperty(wrapped, "asProvider", {
    value: () => provideFactory(token, [], () => factory()),
    writable: false,
    enumerable: false,
  });

  return wrapped;
}
