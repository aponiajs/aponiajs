import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  Req,
  createToken,
  dynamicModule,
  observeSystemLogger,
  provideFactory,
  provideValue,
  type DynamicModule,
  type LoggerService,
} from "@aponiajs/common";
import {
  BOOT_DIAGNOSTICS,
  matchedRouteOf,
  provideRequestLifecycleHooksAsync,
  requirePlatformCapabilities,
  type AponiaBootDiagnostics,
  type BootDiagnosticsRef,
  type RequestLifecycleHook,
} from "@aponiajs/platform-core";
import { createLogBuffer, defaultLogBufferCapacity } from "../logging/log-buffer.ts";
import { isRecordableLogger, recordLogger } from "../logging/log-tap.ts";
import type { LogStream } from "../logging/log-tap.ts";
import {
  createRequestCapture,
  resolveCapture,
  type RequestCapture,
} from "../requests/request-capture.ts";
import type { RequestBuffer } from "../interfaces/request-buffer.interface.ts";
import { createHandlers } from "../server/devtools-server.ts";
import { devtoolsPathPrefix, isDevtoolsSurfaceRequest } from "../server/request-router.ts";
import type { DevtoolsHandlers } from "../interfaces/devtools-server.interface.ts";
import type { DevtoolsOptions } from "../interfaces/devtools-module.interface.ts";

const devtoolsModuleId = "DevtoolsModule";
const devtoolsKey = "devtools";

const devtoolsLogger = new Logger("Devtools", { timestamp: true });

// Tap any observed system logger into its own buffer so that applications
// enabling devtools without an explicit logger option still capture boot lines.
observeSystemLogger((logger) => {
  recordLogger(logger, createLogBuffer(defaultLogBufferCapacity));
});

/** The registration state two boots of one module share. @internal */
interface DevtoolsRegistration {
  readonly options: DevtoolsOptions;
  readonly capture: RequestCapture;
  readonly logs: () => LogStream | undefined;
  readonly captureBody: boolean;
  readonly logger: LoggerService;
}

/** What one boot's surface needs. @internal */
interface DevtoolsBoot {
  readonly identity: object;
  readonly diagnostics: () => AponiaBootDiagnostics | undefined;
  readonly requests: RequestBuffer;
  readonly capture: RequestCapture;
  readonly captureBody: boolean;
  readonly options: DevtoolsOptions;
  handlers(): DevtoolsHandlers;
  onApplicationBootstrap(): void;
}

const DEVTOOLS_REGISTRATION = createToken<DevtoolsRegistration>("aponia.devtools.registration");
const DEVTOOLS_BOOT = createToken<DevtoolsBoot>("aponia.devtools.boot");

/**
 * The module an application imports to opt in to the devtools surface.
 *
 * ```ts
 * @Module({ imports: [DevtoolsModule.forRoot({ enabled: Bun.env.NODE_ENV !== "production" })] })
 * export class AppModule {}
 * ```
 *
 * The surface is a controller mounted under `/__devtools` and its request
 * record is a neutral `RequestLifecycleHook`, so it answers the same way on
 * every platform. What it reports is the neutral boot record: compiled plans,
 * callback routes, enhancers, and gateway plans.
 */
@Module({})
export class DevtoolsModule {
  /**
   * Builds the devtools module for one application. A disabled registration is
   * inert — it mounts no provider and no controller — while an enabled one
   * serves the surface on the application's own route table.
   *
   * `enabled` is read while the module is registered, because a disabled
   * registration must not hold a single provider.
   *
   * @param options - The enabled switch, logger handover, and capture policy.
   * @returns A frozen registration the application's `imports` accepts.
   */
  static forRoot(options: DevtoolsOptions): DynamicModule {
    if (!options.enabled) {
      return createInertModule();
    }

    const capture = createRequestCapture(options.capture);
    const resolvedCapture = resolveCapture(options.capture);
    const registration: DevtoolsRegistration = Object.freeze({
      options,
      capture,
      logs: createLogStream(options.logger),
      captureBody: resolvedCapture.enabled && resolvedCapture.body,
      logger: devtoolsLogger,
    });

    return dynamicModule({
      module: DevtoolsModule,
      id: `${devtoolsModuleId}[${devtoolsKey}]`,
      instanceId: Symbol.for(`aponia.devtools:${devtoolsKey}`),
      providers: [
        provideValue(DEVTOOLS_REGISTRATION, registration),
        provideFactory(
          DEVTOOLS_BOOT,
          [BOOT_DIAGNOSTICS, DEVTOOLS_REGISTRATION],
          (diagnostics: BootDiagnosticsRef, state: DevtoolsRegistration) =>
            createBoot(state, diagnostics),
        ),
        provideRequestLifecycleHooksAsync([DEVTOOLS_BOOT], (boot) =>
          createDevtoolsHook(boot, registration.capture),
        ),
        requirePlatformCapabilities("devtools", ["http"]),
      ],
      controllers: [DevtoolsController],
      exports: [],
    });
  }

  /**
   * Builds the devtools module for one application.
   *
   * @deprecated Use {@link DevtoolsModule.forRoot}; retained for the beta line.
   */
  static register(options: DevtoolsOptions): DynamicModule {
    return DevtoolsModule.forRoot(options);
  }
}

function createInertModule(): DynamicModule {
  return Object.freeze({
    module: DevtoolsModule,
    id: devtoolsModuleId,
    instanceId: Symbol(devtoolsModuleId),
    imports: Object.freeze([]),
    providers: Object.freeze([]),
  });
}

function createBoot(
  registration: DevtoolsRegistration,
  diagnostics: BootDiagnosticsRef,
): DevtoolsBoot {
  const identity: object = {};
  const requests = registration.capture.beginBoot(identity);
  const read = (): AponiaBootDiagnostics | undefined => diagnostics.current;
  let handlers: DevtoolsHandlers | undefined;
  return Object.freeze({
    identity,
    diagnostics: read,
    requests,
    capture: registration.capture,
    captureBody: registration.captureBody,
    options: registration.options,
    handlers(): DevtoolsHandlers {
      // Built on the first request, after the boot published its record.
      handlers ??= createHandlers(read(), registration.logs(), requests, registration.logger);
      return handlers;
    },
    onApplicationBootstrap(): void {
      // Said once, after every route has mounted and before the first request is
      // answered. It reports the mount rather than performing it: the surface
      // answers with or without this line.
      devtoolsLogger.log(
        `Aponia devtools is mounted at ${devtoolsPathPrefix} on the application's own address.`,
      );
    },
  });
}

function createDevtoolsHook(boot: DevtoolsBoot, capture: RequestCapture): RequestLifecycleHook {
  const stores = new WeakMap<Request, { readonly body?: string }>();

  return {
    name: "devtools",
    async onRequest(request) {
      if (isDevtoolsSurfaceRequest(request)) {
        return undefined;
      }
      const body = boot.captureBody
        ? await request
            .clone()
            .text()
            .catch(() => undefined)
        : undefined;
      capture.arrive(request, boot.identity);
      stores.set(request, body === undefined ? {} : { body });
      return undefined;
    },
    async onResponse(request, response) {
      const entry = stores.get(request);
      if (isDevtoolsSurfaceRequest(request) || entry === undefined) {
        return;
      }
      stores.delete(request);
      await capture.complete(
        {
          request,
          route: matchedRouteOf(request),
          body: entry.body,
          status: response.status,
          answered: true,
          answer: response,
          error: undefined,
        },
        performance.now(),
      );
    },
    async onError(request, error) {
      const entry = stores.get(request);
      if (isDevtoolsSurfaceRequest(request) || entry === undefined) {
        return;
      }
      stores.delete(request);
      await capture.complete(
        {
          request,
          route: matchedRouteOf(request),
          body: entry.body,
          status: statusOf(error),
          answered: true,
          answer: undefined,
          error,
        },
        performance.now(),
      );
    },
  };
}

function statusOf(error: unknown): number {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }
  }
  return 500;
}

function createLogStream(source: DevtoolsOptions["logger"]): () => LogStream | undefined {
  if (source === false) {
    return () => undefined;
  }
  const buffer = createLogBuffer(defaultLogBufferCapacity);
  let stream: LogStream | undefined;
  if (source === undefined) {
    observeSystemLogger((logger) => {
      stream ??= recordLogger(logger, buffer);
    });
  } else if (isRecordableLogger(source)) {
    stream = recordLogger(source, buffer);
  }
  return () => stream;
}

/**
 * The controller one enabled registration mounts.
 *
 * Every endpoint is a `GET`; the dispatcher still answers `404` for a path it
 * does not own and `405` when it is asked directly. A non-`GET` request through
 * the router is a routing `404` rather than the dispatcher's `405` — the
 * documented degradation of mounting explicit routes.
 */
@Controller(devtoolsPathPrefix)
class DevtoolsController {
  readonly #boot: DevtoolsBoot;
  readonly #options: DevtoolsOptions;

  constructor(@Inject(DEVTOOLS_BOOT) boot: DevtoolsBoot) {
    this.#boot = boot;
    this.#options = boot.options;
  }

  @Get("")
  index(@Req() request: Request): Promise<Response> {
    return this.#answer("", request);
  }

  @Get("meta")
  meta(@Req() request: Request): Promise<Response> {
    return this.#answer("/meta", request);
  }

  @Get("graph")
  graph(@Req() request: Request): Promise<Response> {
    return this.#answer("/graph", request);
  }

  @Get("routes")
  routes(@Req() request: Request): Promise<Response> {
    return this.#answer("/routes", request);
  }

  @Get("flow")
  flow(@Req() request: Request): Promise<Response> {
    return this.#answer("/flow", request);
  }

  @Get("aot")
  aot(@Req() request: Request): Promise<Response> {
    return this.#answer("/aot", request);
  }

  @Get("logs")
  logs(@Req() request: Request): Promise<Response> {
    return this.#answer("/logs", request);
  }

  @Get("requests")
  requests(@Req() request: Request): Promise<Response> {
    return this.#answer("/requests", request);
  }

  async #answer(key: string, request: Request): Promise<Response> {
    if (this.#options.authorize !== undefined) {
      let allowed = false;
      try {
        allowed = await this.#options.authorize(request);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return new Response(null, {
          status: 401,
          headers: { "cache-control": "no-store" },
        });
      }
    }
    const handler = this.#boot.handlers()[key];
    return handler === undefined ? new Response(null, { status: 404 }) : await handler(request);
  }
}
