import {
  AponiaError,
  Logger,
  tokenName,
  type LoggerService,
  type LogLevel,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import { Elysia, type AnyElysia } from "elysia";
import { isElysiaController } from "./controller.ts";
import { compileRootModule, type AponiaRootModule } from "./decorated-module.ts";

export class AponiaElysiaApplication<TNativeApplication extends AnyElysia = Elysia> {
  readonly #nativeApplication: TNativeApplication;
  readonly #logger: LoggerService | undefined;

  constructor(nativeApplication: TNativeApplication, logger: LoggerService | undefined) {
    this.#nativeApplication = nativeApplication;
    this.#logger = logger;
  }

  getNativeApplication(): TNativeApplication {
    return this.#nativeApplication;
  }

  handle(request: Request): Response | Promise<Response> {
    return this.#nativeApplication.handle(request);
  }

  async listen(port: number): Promise<void> {
    try {
      this.#nativeApplication.listen(port);
      await this.#nativeApplication.modules;
      this.#logger?.log("Aponia application successfully started", "AponiaApplication");
      this.#logger?.log(`Application is running on: ${this.getUrl()}`, "AponiaApplication");
    } catch (error) {
      this.#logger?.error(error, "AponiaApplication");
      throw error;
    }
  }

  getUrl(): string {
    const server = this.#nativeApplication.server;
    if (!server) {
      throw new AponiaError(
        "APPLICATION_NOT_LISTENING",
        "app.listen() needs to be called before calling app.getUrl().",
      );
    }

    return server.url.origin;
  }

  async close(): Promise<void> {
    if (this.#nativeApplication.server) {
      await this.#nativeApplication.stop();
    }
  }
}

export type NativeElysiaConfigurator<TNativeApplication extends AnyElysia> = (
  application: Elysia,
) => TNativeApplication;

export interface AponiaApplicationOptions {
  readonly logger?: false | LoggerService | readonly LogLevel[];
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: NativeElysiaConfigurator<TNativeApplication>;
}

export class AponiaFactory {
  static create<const TNativeApplication extends AnyElysia>(
    rootModule: AponiaRootModule,
    options: ConfiguredAponiaApplicationOptions<TNativeApplication>,
  ): Promise<AponiaElysiaApplication<TNativeApplication>>;
  static create(
    rootModule: AponiaRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<AponiaElysiaApplication>;
  static async create(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AponiaElysiaApplication<AnyElysia>> {
    const logger = createSystemLogger(options.logger);
    logger?.log("Starting Aponia application...", "AponiaFactory");

    const compiledRootModule = compileRootModule(rootModule);
    const container = createContainer(compiledRootModule);
    const baseApplication = new Elysia({ name: compiledRootModule.id });
    const configureNative = "configureNative" in options ? options.configureNative : undefined;
    const nativeApplication = configureNative ? configureNative(baseApplication) : baseApplication;
    if (nativeApplication !== baseApplication) {
      throw new AponiaError(
        "INVALID_NATIVE_APPLICATION",
        "configureNative must return the Elysia application it receives.",
      );
    }

    for (const module of container.graph.modules) {
      container.initializeModule(module);
      logger?.log(`${module.id} dependencies initialized`, "InstanceLoader");
    }

    for (const module of container.graph.modules) {
      for (const controller of module.controllers) {
        if (!isElysiaController(controller)) {
          const controllerName = tokenName(controller.token);
          throw new AponiaError(
            "UNSUPPORTED_CONTROLLER",
            `Controller "${controllerName}" is not supported by the Elysia platform.`,
            { module: module.id, controller: controllerName },
          );
        }

        const instance = container.instantiateController(module, controller);
        const plugin = Reflect.apply(controller.buildPlugin, undefined, [instance]);
        if (!(plugin instanceof Elysia)) {
          throw new AponiaError(
            "UNSUPPORTED_CONTROLLER",
            `Controller "${tokenName(controller.token)}" did not build an Elysia plugin.`,
            { module: module.id, controller: tokenName(controller.token) },
          );
        }

        if (logger) {
          const controllerName = tokenName(controller.token);
          const controllerPath = controller.path ?? inferControllerPath(plugin);
          logger.log(`${controllerName} {${controllerPath}}:`, "RoutesResolver");
          for (const route of plugin.routes) {
            logger.log(
              `Mapped {${route.path}, ${String(route.method).toUpperCase()}} route`,
              "RouterExplorer",
            );
          }
        }
        nativeApplication.use(plugin);
      }
    }

    await nativeApplication.modules;
    return new AponiaElysiaApplication(nativeApplication, logger);
  }
}

function createSystemLogger(
  loggerOption: AponiaApplicationOptions["logger"],
): LoggerService | undefined {
  if (loggerOption === false) {
    return undefined;
  }
  if (Array.isArray(loggerOption)) {
    return new Logger("AponiaFactory", {
      logLevels: loggerOption,
      timestamp: true,
    });
  }
  if (loggerOption) {
    return loggerOption as LoggerService;
  }

  return new Logger("AponiaFactory", { timestamp: true });
}

function inferControllerPath(plugin: Elysia): string {
  const firstRoute = plugin.routes[0]?.path;
  return firstRoute ?? "/";
}
