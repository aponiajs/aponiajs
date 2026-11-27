import { AponiaError } from "../exceptions/aponia-error.ts";
import { provideFactory } from "../providers/provider.ts";
import { type Provider } from "../interfaces/provider.interface.ts";
import { PLATFORM_ADAPTER_HOST } from "../platform/platform-module.ts";
import type { PlatformAdapterHost } from "../platform/platform-module.types.ts";

/**
 * The running platform's native application, injectable without importing the
 * platform package.
 *
 * Mirrors Nest's `HttpAdapterHost`: a provider reads `httpAdapter` to reach the
 * object its runtime created (the Elysia instance, the Hono application, the H3
 * app) instead of depending on a runtime package. The boot provides one per
 * application; `setHttpAdapter` exists for the same reason Nest's does, a test
 * or a host that constructs the application outside the factory.
 *
 * @example
 * ```ts
 * @Injectable()
 * class FilesService {
 *   constructor(private readonly host: HttpAdapterHost) {}
 *
 *   native(): unknown {
 *     return this.host.httpAdapter;
 *   }
 * }
 * ```
 */
export class HttpAdapterHost<TNative = unknown> {
  #adapter: TNative | undefined;

  constructor(host?: PlatformAdapterHost<TNative>) {
    this.#adapter = host?.nativeApplication;
  }

  /**
   * The native application the platform created.
   *
   * @throws An `AponiaError` with `INVALID_NATIVE_APPLICATION` when no adapter
   * has been set, which is the shape of a host that never booted.
   */
  get httpAdapter(): TNative {
    if (this.#adapter === undefined) {
      throw new AponiaError(
        "INVALID_NATIVE_APPLICATION",
        "HttpAdapterHost.httpAdapter was read before the application booted.",
        { adapter: "http" },
      );
    }
    return this.#adapter;
  }

  /**
   * Sets the native application this host answers with.
   *
   * @param adapter - The runtime's own application object.
   */
  setHttpAdapter(adapter: TNative): void {
    this.#adapter = adapter;
  }
}

/**
 * The provider every boot registers so `HttpAdapterHost` is injectable.
 *
 * @returns A factory provider bound to the platform adapter host.
 */
export function provideHttpAdapterHost(): Provider {
  return provideFactory(
    HttpAdapterHost,
    [PLATFORM_ADAPTER_HOST],
    (host: PlatformAdapterHost<unknown>) => new HttpAdapterHost(host),
  );
}
