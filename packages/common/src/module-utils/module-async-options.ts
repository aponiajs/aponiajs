import { getConstructorDependencies } from "../decorators/decorators.ts";
import { AponiaError } from "../exceptions/aponia-error.ts";
import { provideClass, provideFactory } from "../providers/provider.ts";
import type { Provider } from "../interfaces/provider.interface.ts";
import type { ClassToken, Constructor, Token } from "../interfaces/token.interface.ts";
import type { ModuleAsyncOptions, ModuleOptionsFactory } from "../interfaces/module.interface.ts";

/** The default method an options-factory class implements. */
const defaultFactoryMethod = "create";

/**
 * Builds the providers an asynchronous module registration contributes.
 *
 * This is the one implementation of Nest's async-options wiring. It accepts
 * the same three shapes `ModuleAsyncOptions` states:
 *
 * - `useFactory` becomes one factory provider resolving the options token from
 *   its `inject` tokens;
 * - `useClass` becomes the options provider plus a class provider for the
 *   factory, whose constructor dependencies are read from
 *   `design:paramtypes` exactly as Nest's container does;
 * - `useExisting` becomes the options provider pointing at the existing one.
 *
 * A factory that returns a Promise is awaited, and `transform` runs after the
 * await, so a package validates the resolved options once, at the same point
 * `forRoot` validates a literal.
 *
 * @param token - The options token the registration exposes.
 * @param options - The caller's asynchronous registration.
 * @param transform - Normalizes or validates the resolved options; a rejection
 * refuses the boot.
 * @param factoryMethod - The method a factory class implements; defaults to
 * `create`.
 * @returns Frozen providers the registration contributes.
 * @throws An `AponiaError` with `INVALID_CONFIGURATION` when the registration
 * states none of the three shapes.
 *
 * @example
 * ```ts
 * static forRootAsync(options: ModuleAsyncOptions<CacheOptions>): DynamicModule {
 *   return registration(moduleOptionsProviders(CACHE_OPTIONS, options, resolveOptions));
 * }
 * ```
 */
export function moduleOptionsProviders<TOptions, TResolved = TOptions>(
  token: Token<TResolved>,
  options: ModuleAsyncOptions<TOptions>,
  transform: (resolved: TOptions) => TResolved | Promise<TResolved> = (resolved) =>
    resolved as unknown as TResolved,
  factoryMethod: string = defaultFactoryMethod,
): readonly Provider[] {
  if (!("useFactory" in options) && !("useClass" in options) && !("useExisting" in options)) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      "An asynchronous module registration needs useFactory, useClass, or useExisting.",
    );
  }

  if ("useFactory" in options) {
    const useFactory = options.useFactory;
    return Object.freeze([
      provideFactory(token, options.inject ?? [], async (...dependencies: readonly unknown[]) =>
        transform(await useFactory(...(dependencies as never[]))),
      ) as Provider,
    ]);
  }

  const factoryClass = "useClass" in options ? options.useClass : options.useExisting;
  const providers: Provider[] = [
    provideFactory(token, [factoryClass], async (instance: unknown) =>
      transform(await readOptionsFactory<TOptions>(instance, factoryMethod)),
    ) as Provider,
  ];

  if ("useClass" in options) {
    providers.push(
      provideClass(
        factoryClass as ClassToken<ModuleOptionsFactory<TOptions>> &
          Constructor<ModuleOptionsFactory<TOptions>, readonly unknown[]>,
        getConstructorDependencies(factoryClass),
      ) as Provider,
    );
  }

  return Object.freeze(providers);
}

/** Reads the options from a factory class, awaiting an asynchronous method. */
async function readOptionsFactory<TOptions>(instance: unknown, method: string): Promise<TOptions> {
  const factory = (instance as Record<string, (() => TOptions | Promise<TOptions>) | undefined>)[
    method
  ];
  if (typeof factory !== "function") {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `A configurable module options factory must implement "${method}".`,
      { method },
    );
  }
  return await factory.call(instance);
}
