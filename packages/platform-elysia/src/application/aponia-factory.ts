import type { AnyElysia } from "elysia";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { bootstrapAponiaApplication } from "./application-bootstrap.ts";
import { AponiaApplication } from "./aponia-elysia-application.ts";
import { AponiaApplicationContext } from "./application-context.ts";
import type {
  AponiaApplicationOptions,
  ConfiguredAponiaApplicationOptions,
} from "./application.types.ts";
import type { ElysiaApplication } from "./native-application.types.ts";

/**
 * The entrypoint every Aponia application boots through.
 *
 * `create` returns the managed lifecycle facade; `createNative` returns the
 * composed Elysia instance itself for native tooling such as Eden Treaty.
 * Both share one bootstrap: logger, graph compile, Elysia creation, plugin
 * mount, controller mount, lifecycle passes.
 */
export class AponiaFactory {
  /**
   * Boots a module graph without an HTTP listener.
   *
   * Providers initialize and their lifecycle hooks run; controllers are not
   * mounted. Use it for workers, command-line tasks, and container tests.
   *
   * @param rootModule - The root class, descriptor, or descriptor artifact.
   * @param options - Logger, descriptor, and microservice options.
   * @returns The context, with `get`, `resolve`, and `close`.
   */
  static createApplicationContext(
    rootModule: AponiaRootModule,
    options: Pick<AponiaApplicationOptions, "logger" | "descriptors" | "microservices"> = {},
  ): Promise<AponiaApplicationContext> {
    return AponiaApplicationContext.create(rootModule, options);
  }

  /**
   * Bootstraps an application behind Aponia's managed lifecycle facade.
   *
   * @param rootModule - The root class, descriptor, or descriptor artifact.
   * @param options - Logger, native plugins, enhancers, artifacts, and Elysia policy.
   * @returns The application wrapper with `handle`, `listen`, `get`, and `close`.
   *
   * @example
   * ```ts
   * const application = await AponiaFactory.create(AppModule);
   * await application.listen(3000);
   * ```
   */
  static create<
    const TRootModule extends AponiaRootModule,
    const TNativeApplication extends AnyElysia,
  >(
    rootModule: TRootModule,
    options: ConfiguredAponiaApplicationOptions<TNativeApplication>,
  ): Promise<AponiaApplication<ElysiaApplication<TRootModule, TNativeApplication>>>;
  static create<const TRootModule extends AponiaRootModule>(
    rootModule: TRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<AponiaApplication<ElysiaApplication<TRootModule>>>;
  static async create(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AponiaApplication<AnyElysia>> {
    const { nativeApplication, logger } = await bootstrapAponiaApplication(rootModule, options);
    return new AponiaApplication(nativeApplication, logger);
  }

  /**
   * Bootstraps and returns the composed Elysia instance itself.
   *
   * Statically declared native plugins and controller plugins retain their
   * exact route types for native Elysia tooling such as Eden Treaty.
   *
   * @param rootModule - The root class, descriptor, or descriptor artifact.
   * @param options - Logger, native plugins, enhancers, artifacts, and Elysia policy.
   * @returns The composed native Elysia application.
   *
   * @example
   * ```ts
   * const native = await AponiaFactory.createNative(AppModule);
   * ```
   */
  static createNative<
    const TRootModule extends AponiaRootModule,
    const TNativeApplication extends AnyElysia,
  >(
    rootModule: TRootModule,
    options: ConfiguredAponiaApplicationOptions<TNativeApplication>,
  ): Promise<ElysiaApplication<TRootModule, TNativeApplication>>;
  static createNative<const TRootModule extends AponiaRootModule>(
    rootModule: TRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<ElysiaApplication<TRootModule>>;
  static async createNative(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AnyElysia> {
    const { nativeApplication } = await bootstrapAponiaApplication(rootModule, options);
    return nativeApplication;
  }
}
