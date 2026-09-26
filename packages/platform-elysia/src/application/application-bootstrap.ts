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
  type MountedExceptionHandling,
  type MountedRouteEnhancers,
  type ResolvedEnhancers,
} from "../controllers/enhancer-resolver.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import { createDefaultExceptionFilter } from "../errors/default-exception-filter.ts";
import { compileRootModule, isModuleDefinition } from "../modules/module-compiler.ts";
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
import {
  attachApplicationDiagnostics,
  createApplicationDiagnostics,
} from "./application-diagnostics.ts";
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
  // single log line rather than one lookup per controller. The decision is kept
  // whole, because a boot has to be able to say not only that it compiled its
  // own binding but why the artifact could not supply one.
  const invokerSelection = selectInvokerArtifact(options.invokers, aponiaVersion, logger);

  // The generated descriptors are the whole module graph, so the root is chosen
  // once, before anything is compiled: a refused artifact leaves the application
  // it named in place.
  const selectedRootModule = selectRootModuleDescriptor(
    options.descriptors,
    rootModule,
    aponiaVersion,
    logger,
  );
  const compiledRootModule = compileRootModule(selectedRootModule);
  // Which graph served the application is decided by the shape of the root the
  // selector resolved, never by re-reading the artifact: a descriptor is data
  // the container compiles as it stands, while a class and a dynamic module both
  // have their decorators read and lowered, so both are the decorated path.
  const graph: "declared" | "decorated" = isModuleDefinition(selectedRootModule)
    ? "declared"
    : "decorated";
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

  for (const module of container.graph.modules) {
    container.initializeModule(module);
    if (isElysiaPluginModule(module)) {
      nativeApplication.use(getElysiaPlugin(container, module));
    }
    logger?.log(`${module.id} dependencies initialized`, "InstanceLoader");
  }

  // The global enhancers are the application's own declaration, so they resolve
  // once, through the root module, rather than per controller: one instance
  // serves every route whatever module it was mounted from, and a class the root
  // cannot reach fails the boot here with the same MISSING_PROVIDER a missing
  // dependency raises. Resolution waits for the pass above so that a global
  // enhancer is constructed after the providers it may depend on, and it happens
  // whether or not any controller mounts: an application that declares a global
  // enhancer it cannot resolve is refused at boot, not at its first request.
  // The declaration is kept as data beside the resolution it lowers into,
  // because the boot's record publishes it: a plan states what its route
  // declares, and the declaration is the other half of the hook a route runs.
  const globalEnhancerDeclarations: EnhancerMetadata = Object.freeze({
    guards: Object.freeze([...(options.guards ?? [])]),
    interceptors: Object.freeze([...(options.interceptors ?? [])]),
    filters: Object.freeze([...(options.filters ?? [])]),
  });
  const globalEnhancers: ResolvedEnhancers = resolveEnhancers(
    container,
    container.graph.root,
    globalEnhancerDeclarations,
  );

  // Elysia runs a route's own `error` array only while composing routes ahead of
  // time: its dynamic dispatcher, which `aot: false` selects, consults the root
  // application's single `error` hook and each exception's own `toResponse()`
  // and never the array a route carries. The filters a route declares and the
  // mapping built below therefore do not run under that policy, and an
  // unhandled failure answers Elysia's native `500` carrying the exception's
  // message — the leak the mapping exists to prevent. The policy is a
  // compatibility escape hatch, so the boot states what it disabled instead of
  // leaving an application to discover it from a leaked message.
  if (options.elysia?.aot === false) {
    logger?.warn(
      "Elysia's AOT compilation is disabled (elysia: { aot: false }), so declared exception filters " +
        "and the default Problem Details mapping never run: an unhandled failure answers Elysia's " +
        "native 500 carrying the exception's message.",
      "RoutesResolver",
    );
  }

  // The Problem Details mapping every route carries last is built once, from
  // the logger this boot reports on, and travels with each mount beside the
  // global enhancers: a route's `error` array is assembled while it mounts, so
  // this is the only place a boot's own mapping exists. The logger travels with
  // it because the wrapper around each declared filter reports a filter that
  // threw where an application reads its logs, and it has nowhere else to.
  const exceptionHandling: MountedExceptionHandling = Object.freeze({
    defaultFilter: createDefaultExceptionFilter(logger),
    logger,
  });

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
      // The two resolutions travel together from here: every path this
      // controller's routes mount through carries both, which is what makes a
      // global enhancer reach a route mounted through any of them.
      const mountedEnhancers: MountedRouteEnhancers = Object.freeze({
        global: globalEnhancers,
        controller: resolvedEnhancers,
        exceptionHandling,
      });
      if (typeof controller.registerRoutes === "function") {
        const routeStart = nativeApplication.routes.length;
        registerControllerRoutes(
          controller,
          nativeApplication,
          instance,
          invokerSelection.invokers,
          mountedEnhancers,
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

  // The boot's own record, attached to the application it returns: which root
  // the container compiled, what it decided about the invoker artifact, the
  // compiled root, every plan the controllers mounted from, and the
  // application's own enhancer declaration. Those are the facts a consumer
  // cannot recover from the mounted application — a route keeps its method and
  // path, never the module or controller that declared it — and the record is
  // attached here, once the container holds every plan, rather than after the
  // gateway work, which mounts through its own path.
  attachApplicationDiagnostics(
    nativeApplication,
    createApplicationDiagnostics({
      framework: aponiaVersion,
      graph,
      invokers: {
        accepted: invokerSelection.invokers !== undefined,
        reason: invokerSelection.reason,
      },
      rootModule: compiledRootModule,
      modules: container.graph.modules,
      globalEnhancers: globalEnhancerDeclarations,
    }),
  );

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
 * A controller whose descriptor carries a compiled plan is mounted from that
 * plan, which is the one place the enhancers resolved for this controller exist:
 * a plan's hooks are built while it mounts, and nothing else can state them. A
 * controller without one mounts through the callback it was defined with, and
 * that callback owns its routes' hooks.
 */
function registerControllerRoutes(
  controller: RuntimeElysiaController,
  application: Elysia,
  instance: unknown,
  invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory> | undefined,
  mountedEnhancers: MountedRouteEnhancers,
): void {
  const compiledRoutes = controller.compiledRoutes;
  if (!compiledRoutes) {
    registerElysiaControllerRoutes(controller, application, instance);
    return;
  }

  // Elysia controllers are always class-backed, which is what makes the token
  // safe as a minification-proof key.
  const controllerToken = controller.token as ClassToken<unknown>;
  const createInvokers = invokers?.get(controllerToken);
  registerCompiledElysiaRoutes(
    application,
    controllerToken,
    instance,
    compiledRoutes,
    mountedEnhancers,
    createInvokers?.(instance as never),
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
