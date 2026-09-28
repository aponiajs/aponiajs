import {
  AponiaError,
  Logger,
  tokenName,
  type ClassToken,
  type EnhancerMetadata,
  type LoggerService,
  type Token,
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
  type InterceptorHalves,
  type MountedExceptionHandling,
  type MountedRouteEnhancers,
  type ResolvedControllerEnhancers,
} from "../controllers/enhancer-resolver.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import {
  createDefaultExceptionFilter,
  reportThroughLogger,
} from "../errors/default-exception-filter.ts";
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
import type { AponiaCallbackRouteDiagnostics } from "./application-diagnostics.types.ts";
import type { ApplicationBootstrapResult } from "./application-bootstrap.types.ts";
import type {
  AponiaApplicationOptions,
  ConfiguredAponiaApplicationOptions,
} from "./application.types.ts";
import {
  attachApplicationShutdown,
  collectLifecycleCalls,
  type LifecycleCall,
} from "./lifecycle-hooks.ts";

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
  // it named in place. The selection carries the artifact's own release stamp,
  // which is what the record publishes below: "an artifact supplied this graph"
  // and "the release that wrote it" are two different facts, and only the
  // selector can state the second.
  const rootSelection = selectRootModuleDescriptor(
    options.descriptors,
    rootModule,
    aponiaVersion,
    logger,
  );
  const compiledRootModule = compileRootModule(rootSelection.rootModule);
  // Which graph served the application is decided by the shape of the root the
  // selector resolved, never by re-reading the artifact: a descriptor is data
  // the container compiles as it stands, while a class and a dynamic module both
  // have their decorators read and lowered, so both are the decorated path.
  const graph: "declared" | "decorated" = isModuleDefinition(rootSelection.rootModule)
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

  // The application's own plugins mount here, beside the module-graph pass and
  // for the same reason: a plugin contributes routes and request context, so it
  // is in place before any controller mounts beside it. They mount first
  // because the application named them, and both hook phases run in mount
  // order, so a hook they declare runs before one a module's plugin declares.
  // Nothing resolves from the container on this path — an entry is the plugin
  // value itself, not a token — so no entry can fail the boot, and one that is
  // `undefined` mounts nothing at all.
  for (const plugin of options.plugins ?? []) {
    if (plugin === undefined) {
      continue;
    }
    nativeApplication.use(plugin);
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
  const globalEnhancers: ResolvedControllerEnhancers = resolveEnhancers(
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
  //
  // The map is created here, beside the exception handling it belongs to,
  // because it is that mapping's own record: the `Response` the mapping answers
  // with is not on the after-response context, so the exception it decided on is
  // readable afterwards only where it wrote it down. It is one boot's — a
  // second boot creates a second map — and it is published on the boot record
  // below rather than frozen into it, because it keeps receiving the exceptions
  // the mapping answers.
  const mappedExceptions = new WeakMap<Request, string>();
  const exceptionHandling: MountedExceptionHandling = Object.freeze({
    defaultFilter: createDefaultExceptionFilter(logger, mappedExceptions),
    logger,
  });

  // The facts the record publishes that are not readable afterwards, so the
  // mounts that decide them collect them here. Which property keys a supplied
  // invoker bound is settled one route at a time while the route registers, a
  // callback's routes are named by the callback that mounted them, which no
  // entry of the mounted table remembers, and the halves an interceptor class
  // implements are legible only while the instance that implements them is in
  // hand — a half declared as a class field is an own property of that instance
  // and the token a plan carries never states it.
  const generatedInvokers = new Map<Token<unknown>, ReadonlySet<string | symbol>>();
  const callbackRoutes: AponiaCallbackRouteDiagnostics[] = [];
  const interceptorHalves = new Map<ClassToken<unknown>, InterceptorHalves>();
  // The application's own declaration resolves first, so it is collected first.
  // Both scopes merge into one map because a class declares one set of halves
  // wherever it is named: a class resolved at both scopes contributes the same
  // two booleans twice, so the later merge overwrites an identical value rather
  // than correcting an earlier one, and no guard is needed to say so.
  collectInterceptorHalves(interceptorHalves, globalEnhancers.halves);

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
      collectInterceptorHalves(interceptorHalves, resolvedEnhancers.halves);
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
        const generatedKeys = registerControllerRoutes(
          controller,
          nativeApplication,
          instance,
          invokerSelection.invokers,
          mountedEnhancers,
        );
        // The table grew by exactly the routes this controller mounted, which is
        // the slice the boot reports on `RoutesResolver` and the only observation
        // of a callback's own routes that names their controller.
        const mountedRoutes = nativeApplication.routes.slice(routeStart);
        logControllerRoutes(logger, controller, mountedRoutes);
        if (controller.compiledRoutes === undefined) {
          collectCallbackRoutes(callbackRoutes, module.id, controller, mountedRoutes);
        } else if (generatedKeys !== undefined) {
          generatedInvokers.set(controller.token, generatedKeys);
        }
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

      const pluginRouteStart = nativeApplication.routes.length;
      logControllerRoutes(logger, controller, plugin.routes);
      nativeApplication.use(plugin);
      collectCallbackRoutes(
        callbackRoutes,
        module.id,
        controller,
        nativeApplication.routes.slice(pluginRouteStart),
      );
    }
  }

  // The graph is instantiated — providers in the first pass, controllers in the
  // second — and the modules now initialize in the order `graph.modules` already
  // holds them, which is post-order, so a module that imports another runs after
  // it. The hooks do not interleave with instantiation: every module's providers
  // and controllers exist before the first hook runs, so what this orders is
  // modules rather than isolating one.
  for (const call of collectLifecycleCalls(container, "onModuleInit")) {
    await call();
  }

  // The shutdown plan is collected once, while the container holds every
  // instance, and handed to the wrapper through the symbol seam below. Reading
  // it here rather than from the container later means `close()` needs no
  // container: an application the boot did not produce reads as `undefined` and
  // keeps the behaviour it has today.
  const beforeShutdown = collectLifecycleCalls(container, "beforeApplicationShutdown");
  const moduleDestroy = [...collectLifecycleCalls(container, "onModuleDestroy")].reverse();
  const applicationShutdown = collectLifecycleCalls(container, "onApplicationShutdown");

  // A second `close()` runs nothing. Teardown hooks are not idempotent — a pool
  // closed twice is the defect the seam exists to prevent — and the `close()` this
  // replaces was already a no-op once the server had stopped.
  let stopped = false;

  attachApplicationShutdown(nativeApplication, async (closeActiveConnections = true) => {
    if (stopped) {
      return;
    }
    stopped = true;

    await runShutdownHooks(beforeShutdown, logger);
    if (nativeApplication.server) {
      await nativeApplication.stop(closeActiveConnections);
    }
    await runShutdownHooks(moduleDestroy, logger);
    await runShutdownHooks(applicationShutdown, logger);
  });

  // The boot's own record, attached to the application it returns: which root
  // the container compiled, what it decided about the invoker artifact, which
  // release supplied each artifact it adopted, the compiled root, every plan the
  // controllers mounted from with the binding that serves it, the routes a
  // callback added, and the application's own enhancer declaration. Those are
  // the facts a consumer cannot recover from the mounted application — a route
  // keeps its method and path, never the module, the controller, or the property
  // key that declared it — and the record is attached here, once the container
  // holds every plan, rather than after the gateway work, which mounts through
  // its own path.
  attachApplicationDiagnostics(
    nativeApplication,
    createApplicationDiagnostics({
      framework: aponiaVersion,
      graph,
      invokers: {
        accepted: invokerSelection.invokers !== undefined,
        reason: invokerSelection.reason,
      },
      artifacts: {
        invokers: invokerSelection.builtBy,
        descriptors: rootSelection.builtBy,
      },
      rootModule: compiledRootModule,
      modules: container.graph.modules,
      generatedInvokers,
      callbackRoutes,
      globalEnhancers: globalEnhancerDeclarations,
      mappedExceptions,
      interceptorHalves,
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

  // Once, after every route and gateway is mounted and no further plugin work is
  // pending: a hook that needs the whole graph — a scheduler, a migration check,
  // a cache warm — has one place to stand, and it is before anything can listen.
  for (const call of collectLifecycleCalls(container, "onApplicationBootstrap")) {
    await call();
  }

  return Object.freeze({ nativeApplication, logger });
}

/**
 * Runs shutdown hooks in order, reporting a failure and carrying on.
 *
 * A pool that refuses to close must not be able to keep every other pool open,
 * and `close()` may not become a call that cannot complete, so each failure is
 * reported where an application reads its logs and the next hook still runs.
 * This is a failure-reporting call site and goes through the same guarded seam
 * the default mapping does.
 */
async function runShutdownHooks(
  calls: readonly LifecycleCall[],
  logger: LoggerService | undefined,
): Promise<void> {
  for (const call of calls) {
    try {
      await call();
    } catch (error) {
      reportThroughLogger(logger, error, "ExceptionsHandler");
    }
  }
}

/**
 * Adds one scope's interceptor halves to the boot's own collection.
 *
 * A class declares one set of halves wherever it is named, so a class resolved
 * both globally and on a route's own list contributes the same two booleans
 * twice: this overwrites an identical value rather than resolving a conflict,
 * which is why nothing here compares the two. The collection is the boot's
 * working map rather than a record field — the record copies it, once every
 * mount that writes into it is done.
 */
function collectInterceptorHalves(
  collected: Map<ClassToken<unknown>, InterceptorHalves>,
  halves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves>,
): void {
  for (const [token, declared] of halves) {
    collected.set(token, declared);
  }
}

/**
 * Registers one controller on the root application, preferring build-time
 * generated invokers when the artifact supplied factories for its token.
 *
 * A controller whose descriptor carries a compiled plan is mounted from that
 * plan, which is the one place the enhancers resolved for this controller exist:
 * a plan's hooks are built while it mounts, and nothing else can state them. It
 * returns the property keys a supplied invoker bound, which is the mount's own
 * decision, and `undefined` for a controller mounted through its registration
 * callback — the path that compiles no plan and consults no invoker. A
 * controller without one mounts through the callback it was defined with, and
 * that callback owns its routes' hooks.
 */
function registerControllerRoutes(
  controller: RuntimeElysiaController,
  application: Elysia,
  instance: unknown,
  invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory> | undefined,
  mountedEnhancers: MountedRouteEnhancers,
): ReadonlySet<string | symbol> | undefined {
  const compiledRoutes = controller.compiledRoutes;
  if (!compiledRoutes) {
    registerElysiaControllerRoutes(controller, application, instance);
    return undefined;
  }

  // Elysia controllers are always class-backed, which is what makes the token
  // safe as a minification-proof key.
  const controllerToken = controller.token as ClassToken<unknown>;
  const createInvokers = invokers?.get(controllerToken);
  return registerCompiledElysiaRoutes(
    application,
    controllerToken,
    instance,
    compiledRoutes,
    mountedEnhancers,
    createInvokers?.(instance as never),
  );
}

/**
 * Records the routes one controller's own callback added to the mounted table.
 *
 * The callback built them from its instance and registered them itself, so the
 * platform compiled no plan and the table keeps no trace of the class property
 * that served them. What it does keep is the controller, through this call
 * site: the slice between the two table lengths was added by one controller of
 * one module. The binding is stated rather than reasoned about — an invoker
 * artifact substitutes handlers in the platform's own compilation, and a
 * callback registers through the native API, so no artifact reaches these
 * routes.
 */
function collectCallbackRoutes(
  routes: AponiaCallbackRouteDiagnostics[],
  moduleId: string,
  controller: RuntimeElysiaController,
  mountedRoutes: readonly { readonly method: string; readonly path: string }[],
): void {
  const controllerName = tokenName(controller.token);
  for (const route of mountedRoutes) {
    routes.push(
      Object.freeze({
        module: moduleId,
        controller: controllerName,
        source: "compiled",
        method: String(route.method),
        path: route.path,
      }),
    );
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
