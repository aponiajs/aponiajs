import {
  AponiaError,
  Logger,
  tokenName,
  type ClassToken,
  type EnhancerMetadata,
  type LoggerService,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import { Elysia, type AnyElysia } from "elysia";
import {
  isElysiaController,
  registerElysiaControllerRoutes,
} from "../controllers/controller-definition.ts";
import {
  collectEnhancerDeclarations,
  resolveEnhancers,
  type ResolvedControllerEnhancers,
} from "../controllers/enhancer-resolver.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import { compileRootModule } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { selectRootModuleDescriptor } from "../modules/module-descriptor-artifact.ts";
import { getElysiaPlugin, isElysiaPluginModule } from "../plugins/plugin-module.ts";
import { selectInvokerArtifact } from "../routing/invoker-artifact.ts";
import type { AponiaControllerInvokerFactory } from "../routing/route-compiler.types.ts";
import { registerCompiledElysiaRoutes } from "../routing/route-compiler.ts";
import {
  compileElysiaWebSocketGateways,
  registerElysiaWebSocketGateways,
} from "../websockets/websocket-gateway.ts";
import { aponiaVersion } from "../version.ts";
import type { ApplicationBootstrapResult } from "./application-bootstrap.types.ts";
import type {
  AponiaApplicationOptions,
  ConfiguredAponiaApplicationOptions,
} from "./application.types.ts";

/**
 * Compile and mount one Aponia module graph onto a native Elysia instance.
 *
 * @internal
 */
export async function bootstrapAponiaApplication(
  rootModule: AponiaRootModule,
  options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
): Promise<ApplicationBootstrapResult> {
  const logger = createSystemLogger(options.logger);
  logger?.log("Starting Aponia application...", "AponiaFactory");

  // Resolved once, before any controller mounts, so a refused artifact costs a
  // single log line rather than one lookup per controller.
  const generatedInvokers = selectInvokerArtifact(options.invokers, aponiaVersion, logger);

  // The generated descriptors are the whole module graph, so the root is chosen
  // once, before anything is compiled: a refused artifact leaves the application
  // it named in place.
  const compiledRootModule = compileRootModule(
    selectRootModuleDescriptor(options.descriptors, rootModule, aponiaVersion, logger),
  );
  const container = createContainer(compiledRootModule);
  const webSocketGateways = compileElysiaWebSocketGateways(container.graph.modules);
  const baseApplication = new Elysia({
    ...options.elysia,
    name: compiledRootModule.id,
  });
  const configureNative = "configureNative" in options ? options.configureNative : undefined;
  const nativeApplication = configureNative ? configureNative(baseApplication) : baseApplication;
  if (nativeApplication !== baseApplication) {
    throw new AponiaError(
      "INVALID_NATIVE_APPLICATION",
      "configureNative must return the Elysia application it receives.",
    );
  }

  // The global enhancers are the application's own declaration and are copied
  // into frozen metadata once, before any controller mounts. They travel to the
  // mount rather than into a compiled route: a compiled plan states what a
  // controller declares and nothing else.
  const globalEnhancers: EnhancerMetadata = Object.freeze({
    guards: Object.freeze([...(options.guards ?? [])]),
    interceptors: Object.freeze([...(options.interceptors ?? [])]),
    filters: Object.freeze([...(options.filters ?? [])]),
  });

  for (const module of container.graph.modules) {
    container.initializeModule(module);
    if (isElysiaPluginModule(module)) {
      nativeApplication.use(getElysiaPlugin(container, module));
    }
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
      // Every enhancer this controller's routes declare is resolved here, while
      // the controller mounts: an undeclared or unreachable class fails the
      // mount with the same MISSING_PROVIDER a missing dependency raises, and
      // each distinct class is resolved once however many routes name it.
      const resolvedEnhancers = resolveEnhancers(
        container,
        module,
        collectEnhancerDeclarations(controller.compiledRoutes ?? []),
      );
      if (typeof controller.registerRoutes === "function") {
        const routeStart = nativeApplication.routes.length;
        registerControllerRoutes(
          controller,
          nativeApplication,
          instance,
          generatedInvokers,
          globalEnhancers,
          resolvedEnhancers,
        );
        logControllerRoutes(logger, controller, nativeApplication.routes.slice(routeStart));
        continue;
      }

      const plugin = Reflect.apply(controller.buildPlugin, undefined, [instance]);
      if (!(plugin instanceof Elysia)) {
        throw new AponiaError(
          "INVALID_CONTROLLER",
          `Controller "${tokenName(controller.token)}" did not build an Elysia plugin.`,
          { module: module.id, controller: tokenName(controller.token) },
        );
      }

      logControllerRoutes(logger, controller, plugin.routes);
      nativeApplication.use(plugin);
    }
  }

  await nativeApplication.modules;
  await registerElysiaWebSocketGateways(nativeApplication, container, webSocketGateways);
  for (const gateway of webSocketGateways) {
    logger?.log(`${gateway.gatewayName} {${gateway.path}}:`, "WebSocketsController");
    for (const handler of gateway.handlers) {
      logger?.log(`Subscribed to "${handler.event}" message`, "WebSocketsController");
    }
  }

  await nativeApplication.modules;
  return Object.freeze({ nativeApplication, logger });
}

/**
 * Registers one controller on the root application, preferring build-time
 * generated invokers when the artifact supplied factories for its token.
 *
 * Only decorated controllers carry a compiled route plan, so an entry for any
 * other controller token is ignored rather than treated as an error.
 */
function registerControllerRoutes(
  controller: RuntimeElysiaController,
  application: Elysia,
  instance: unknown,
  invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory> | undefined,
  globalEnhancers: EnhancerMetadata,
  // A route's hooks are what consume the resolution, and they are compiled from
  // it while the route mounts. Until they exist the resolution travels to the
  // boundary and no further, so the parameter is deliberately inert rather than
  // read and discarded.
  // oxlint-disable-next-line no-unused-vars
  resolvedEnhancers: ResolvedControllerEnhancers,
): void {
  const compiledRoutes = controller.compiledRoutes;
  // Elysia controllers are always class-backed, which is what makes the token
  // safe as a minification-proof key.
  const controllerToken = controller.token as ClassToken<unknown>;
  const createInvokers = invokers?.get(controllerToken);
  if (!compiledRoutes || !createInvokers) {
    registerElysiaControllerRoutes(controller, application, instance, globalEnhancers);
    return;
  }

  registerCompiledElysiaRoutes(
    application,
    controllerToken,
    instance,
    compiledRoutes,
    createInvokers(instance as never),
    globalEnhancers,
  );
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

function logControllerRoutes(
  logger: LoggerService | undefined,
  controller: RuntimeElysiaController,
  routes: readonly { readonly method: string; readonly path: string }[],
): void {
  if (!logger) {
    return;
  }

  const controllerName = tokenName(controller.token);
  const controllerPath = controller.path ?? inferControllerPath(routes);
  logger.log(`${controllerName} {${controllerPath}}:`, "RoutesResolver");
  for (const route of routes) {
    logger.log(
      `Mapped {${route.path}, ${String(route.method).toUpperCase()}} route`,
      "RouterExplorer",
    );
  }
}

function inferControllerPath(routes: readonly { readonly path: string }[]): string {
  const firstRoute = routes[0]?.path;
  return firstRoute ?? "/";
}
