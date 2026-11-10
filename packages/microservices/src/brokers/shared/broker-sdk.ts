import { AponiaError } from "@aponiajs/common";

/**
 * Loads one optional broker SDK.
 *
 * Adapters pass a function that performs the literal dynamic import. Keeping
 * the import inside a closure is what lets a consumer install one broker SDK
 * and leave every other peer absent.
 *
 * @internal
 */
export type BrokerSdkLoader<T> = () => Promise<T>;

/**
 * Loads an optional peer and turns every import failure into one stable error.
 *
 * The SDK's own failure is dropped. A module loader error can include a path or
 * a resolution detail, and an SDK can throw during initialization with a value
 * that names configuration. The package name and transport are the only facts a
 * caller receives.
 *
 * @internal
 */
export async function loadBrokerSdk<T>(
  transport: string,
  packageName: string,
  loader: BrokerSdkLoader<T>,
): Promise<T> {
  try {
    return await loader();
  } catch {
    throw new AponiaError(
      "MICROSERVICE_TRANSPORT_UNAVAILABLE",
      `The microservice transport "${transport}" requires the optional package "${packageName}".`,
      Object.freeze({ transport, package: packageName }),
    );
  }
}

/**
 * The failure an adapter reports when a loaded SDK does not expose the shape it
 * needs.
 *
 * This is a version-compatibility failure rather than a missing package; the
 * caller still receives only the package name and transport.
 *
 * @internal
 */
export function brokerSdkShapeFailure(transport: string, packageName: string): AponiaError {
  return new AponiaError(
    "MICROSERVICE_TRANSPORT_UNAVAILABLE",
    `The optional package "${packageName}" does not expose the interface the "${transport}" transport requires.`,
    Object.freeze({ transport, package: packageName }),
  );
}

/**
 * Asserts one loaded SDK member is callable.
 *
 * @internal
 */
export function requireSdkFunction(
  value: unknown,
  transport: string,
  packageName: string,
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") {
    throw brokerSdkShapeFailure(transport, packageName);
  }
}
