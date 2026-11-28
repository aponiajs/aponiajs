import { Module, type DynamicModule } from "@aponiajs/common";
import type { HttpClientRootOptions } from "./interfaces/http-client.interface.ts";
import { resolveHttpOptions } from "./http-client.providers.ts";
import {
  ConfigurableModuleClass,
  RootConfigurableModuleClass,
  completeRoot,
  type HttpClientModuleAsyncOptions,
} from "./http.module-definition.ts";

/**
 * Provides the SSRF-safe HTTP client.
 *
 * `forRoot` / `forRootAsync` register app-wide defaults (headers, timeout,
 * retry, `fetch`, interceptors) and no client. `register` / `registerAsync`
 * create one client each; without a name it is the default client injected as
 * `HttpClient`/`HttpService`, with one through `@InjectHttpClient(name)`.
 */
@Module({})
export class HttpModule extends ConfigurableModuleClass {
  /**
   * Builds the app-wide defaults registration; it registers no client.
   *
   * @param options - The defaults every client merges, and interceptor classes.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_HTTP_OPTIONS` when an option is invalid.
   */
  static forRoot(options: HttpClientRootOptions = {}): DynamicModule {
    resolveHttpOptions(options);
    return completeRoot(
      Object.freeze({
        ...RootConfigurableModuleClass.forRoot(options as never),
        module: HttpModule,
      }),
    );
  }

  /**
   * Builds the app-wide defaults from DI; it registers no client.
   *
   * @param options - The imports, injected tokens, factory, and interceptor classes.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: HttpClientModuleAsyncOptions): DynamicModule {
    return completeRoot(
      Object.freeze({
        ...RootConfigurableModuleClass.forRootAsync(options as never),
        module: HttpModule,
      }),
    );
  }
}
