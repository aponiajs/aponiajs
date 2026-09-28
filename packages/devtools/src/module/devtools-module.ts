import { Logger, Module, type DynamicModule } from "@aponiajs/common";
import {
  ElysiaPluginModule,
  readApplicationDiagnostics,
  readApplicationFromStore,
} from "@aponiajs/platform-elysia";
import type { NativeElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { createLogBuffer, defaultLogBufferCapacity } from "../logging/log-buffer.ts";
import { isRecordableLogger, tapLogBuffer } from "../logging/log-tap.ts";
import type { TappedLogStream } from "../logging/log-tap.ts";
import { createRequestCapture } from "../requests/request-capture.ts";
import type { RequestCapture } from "../requests/request-capture.ts";
import type { RequestBuffer } from "../requests/request-buffer.types.ts";
import { createHandlers } from "../server/devtools-server.ts";
import {
  devtoolsPathPrefix,
  isDevtoolsSurfaceRequest,
  routeRequest,
} from "../server/request-router.ts";
import type { DevtoolsHandlers } from "../server/devtools-server.types.ts";
import type { DevtoolsOptions } from "./devtools-module.types.ts";

const devtoolsPluginName = "aponia.devtools";
const devtoolsPluginKey = "devtools";
const devtoolsModuleId = "DevtoolsModule";

const devtoolsLogger = new Logger("Devtools", { timestamp: true });

/**
 * The module an application imports to opt in to the devtools surface.
 *
 * ```ts
 * @Module({ imports: [DevtoolsModule.register({ enabled: Bun.env.NODE_ENV !== "production" })] })
 * export class AppModule {}
 * ```
 */
@Module({})
export class DevtoolsModule {
  /**
   * Builds the devtools module for one application. A disabled registration is
   * inert — it mounts no provider and no native plugin — while an enabled one
   * registers the devtools plugin as an `ElysiaPluginModule`, so the surface is
   * part of the application's route table.
   */
  static register(options: DevtoolsOptions): DynamicModule {
    const plugin = devtoolsPlugin(options);
    if (plugin === undefined) {
      return createInertModule();
    }

    return ElysiaPluginModule.register(plugin, { key: devtoolsPluginKey });
  }
}

/**
 * The devtools plugin, for the application that mounts it through
 * `AponiaFactory.create`'s `plugins` option rather than through a module:
 *
 * ```ts
 * const application = await AponiaFactory.create(AppModule, {
 *   plugins: [devtoolsPlugin({ enabled: Bun.env.NODE_ENV !== "production", logger: appLogger })],
 * });
 * ```
 *
 * Both paths build the same plugin through the same construction, so they mount
 * the same hooks and serve the same endpoints. They differ in what `aponia build`
 * can see. `DevtoolsModule.register` belongs in a module's `imports`, and
 * `aponia build` lowers a module only when every `imports` entry names its
 * declaration with a single identifier: an entry that is a call expression
 * declines the module that wrote it, and a declined root leaves the committed
 * descriptor artifact serving a graph the registration is not in. A plugin
 * mounted through this option is not an `imports` entry, so the module that
 * would have been declined stays declarable.
 *
 * The price is stated rather than hidden: a plugin mounted this way is not in
 * the module graph, so nothing about it reaches the generated descriptor
 * artifact or the inspection of a compiled application. Mount the plugin
 * through the module when the graph should carry it.
 *
 * `enabled` gates this path exactly as it gates the module path: a registration
 * that is not enabled returns `undefined`, and the platform mounts no plugin
 * for that value. It is not an inert plugin, for the same reason
 * `DevtoolsModule.register({ enabled: false })` is not an inert module — a boot
 * must not be able to mistake a disabled registration for an enabled one. The
 * switch stays in the options rather than in whether the call happens, so one
 * options object drives both paths: an application that forwards its devtools
 * configuration to this function mounts a debug surface only when it said it
 * wanted one.
 */
export function devtoolsPlugin(options: DevtoolsOptions): NativeElysiaPlugin | undefined {
  if (!options.enabled) {
    return undefined;
  }

  return createDevtoolsPlugin(options);
}

/**
 * The disabled registration stays a module, so an application's `imports` read
 * the same either way, but it carries nothing a boot would mount. It states its
 * own identity because the module graph identifies and names a `DynamicModule`
 * by it.
 */
function createInertModule(): DynamicModule {
  return Object.freeze({
    module: DevtoolsModule,
    id: devtoolsModuleId,
    instanceId: Symbol(devtoolsModuleId),
    imports: Object.freeze([]),
    providers: Object.freeze([]),
  });
}

/**
 * The plugin mounts the surface on the application rather than starting a server
 * of its own, and that is the whole of the difference this release makes: the
 * endpoints used to answer on a second port behind a `Bun.serve` socket, and
 * they now answer on the address the application answers on.
 *
 * What that buys is stated where it is not obvious. The surface is part of the
 * route table, so a client reaches it wherever the application is reachable and
 * a request to the prefix is answered by the application rather than by `404`;
 * and it answers under `handle()` as well as under `listen()`, because a route
 * registered when this plugin is mounted needs no `onStart`. What it costs is
 * the property the old shape had: a surface that could be enabled, disabled, or
 * fall over without changing a single answer the application gives is a surface
 * that owns a socket. The mount is a route, and one route can collide with
 * another — an application route that claims a devtools path wins, because the
 * two owners sit in one route table and the more specific route answers: a
 * static `/__devtools/meta` wins this wildcard whether it mounts before or after
 * it, and the insertion order decides only between two registrations of the same
 * pattern.
 *
 * The route is a wildcard over the prefix and nothing more: it hands every
 * request that reaches it to `routeRequest`, which decides the method and the
 * path. The `404` for a path under the prefix that no endpoint owns and the
 * `405` for a method other than `GET` are that dispatcher's answers, not the
 * wildcard's, so the mount claims nothing about the paths beneath it.
 *
 * The `onStart` hook below says where the surface is mounted and does nothing
 * else. It is not what mounts it, and nothing may move the mount into it:
 * `onStart` does not run for an application that only calls `handle()`, which is
 * exactly the entrypoint this release made the surface reachable through.
 *
 * The request record is contributed by the same plugin, and its pair of hooks is
 * built at the same moment for the same reason: registration is what mounts the
 * plugin, and the plugin is what observes a request. The pair is two hooks on
 * this instance rather than anything the root application holds — this package
 * registers nothing on the root — so the arrival hook rides the request phase,
 * which Elysia merges from a used plugin unfiltered, and the completion hook is
 * declared `{ as: "global" }`, which is the option the installed Elysia reads for
 * an after-response hook to reach routes this plugin does not own. The two are
 * separate answers and neither is a tidiness a maintainer may drop: with the
 * local scope the after-response hook never runs for a controller's route, and
 * the record then stays empty however many requests the application answers.
 *
 * The record a boot's requests are filed in is opened by `recordFor`, on the
 * first request the plugin sees, rather than at `onStart` — see there for why it
 * cannot be a hook call, and why the window must not wait for the first poll.
 *
 * Neither hook returns a value, and that is a rule rather than a style: a hook
 * that returns a truthy one is the answer, so the pair would change what every
 * route receives — the one thing `/requests` claims it cannot do.
 *
 * The completion hook takes the closing reading as its first statement, before it
 * reads a field off the context, and hands it to `complete`, which takes none of
 * its own. That is what makes the duration the interval between the two hooks
 * rather than the interval between the arrival and however much of this package's
 * own work ran before the stamp: the route, the status, the parsed body, the
 * arrival lookup, and the one `await` that reads a `5xx` answer's published body
 * are all outside it. Moving that reading down the hook, or back inside
 * `toRequestRecord`, silently charges the application for this package's work.
 */
function createDevtoolsPlugin(options: DevtoolsOptions): NativeElysiaPlugin {
  const logs = createLogStream(options.logger);
  const capture = createRequestCapture(options.capture);
  // One boot record per application, keyed by the application's own store — see
  // `recordFor` — and one endpoint record per application that reached the
  // surface — see `surfaceFor`. Two maps rather than one, because the two are
  // built at different moments and by different callers: the boot record on the
  // first request the plugin sees, the endpoint record on the first request the
  // surface answers.
  const records = new WeakMap<object, ApplicationRecord>();
  const surfaces = new WeakMap<object, DevtoolsHandlers>();

  return (
    new Elysia({ name: devtoolsPluginName })
      .onRequest((context) => {
        // The surface's own traffic is the one thing this record leaves out, and
        // `isDevtoolsSurfaceRequest` states why. Skipping the arrival is the whole
        // of it: the completion half writes nothing without a stamp to spend, and
        // the two hooks stay one pair.
        if (isDevtoolsSurfaceRequest(context.request)) {
          return;
        }

        // The boot's record is opened here, on the first request the plugin sees,
        // rather than only when the surface is first polled: the record belongs
        // to the boot, so a window that opened at the first poll would answer for
        // the polling client and drop the traffic that arrived before it. It is
        // memoized per application, so this is one `beginBoot` for every request
        // the application answers.
        recordFor(records, context.store, capture);
        capture.arrive(context.request, context.store);
      })
      .onAfterResponse({ as: "global" }, async (context) => {
        // The closing reading is the first statement of this hook, before the five
        // reads below, because every one of them and everything `toRequestRecord`
        // does with them is this package's own work: a duration that included them
        // would report time the application never spent. The single `await` inside
        // `complete` that reads a readable `5xx` answer's published body is outside
        // the measurement for the same reason, and it stays outside only while this
        // reading stays here — moving it after that `await` would charge the
        // application for it.
        const completedAt = performance.now();

        await capture.complete(
          {
            request: context.request,
            route: context.route,
            body: context.body,
            status: context.set.status,
            answer: context.responseValue,
          },
          completedAt,
        );
      })
      // The mount path, stated once. The wildcard is what makes the route claim
      // the prefix rather than one path, and everything about which paths beneath
      // it answer — the `404`, the `405` — belongs to `routeRequest` below.
      .all(`${devtoolsPathPrefix}/*`, ({ request, store }) =>
        routeRequest(
          request,
          surfaceFor(surfaces, store, recordFor(records, store, capture), logs),
        ),
      )
      .onStart(() => {
        // Said once, at the moment a listener exists and the address is real. It is
        // a report rather than a mount: the route above answers with or without
        // this line, which is what an application that only handles requests shows.
        devtoolsLogger.log(
          `Aponia devtools is mounted at ${devtoolsPathPrefix} on the application's own address.`,
        );
      })
  );
}

/**
 * The boot record one application's surface answers from: the application
 * itself, as a plugin mounted on it can reach it while answering a request, and
 * the window the boot's requests are filed in.
 *
 * Both facts the server used to be handed at `onStart` are settled on the
 * request path instead, and both for the same reason: `onStart` never fires for
 * an application that only calls `handle()`, which is exactly the entrypoint
 * this mount made the surface reachable through. The application is read from
 * the store rather than handed in, because `context.store` is the one
 * per-application value a request carries, and the platform publishes the
 * instance on that same store at boot — see `publishApplicationOnStore`.
 *
 * The key is that store, and not the application, because the pair has to be
 * memoized even where there is no application: a registration mounted on a bare
 * `Elysia` by hand serves `/meta` and its stream, and rebuilding its record on
 * every request would be a different bug rather than a smaller one.
 */
interface ApplicationRecord {
  readonly application: Elysia | undefined;
  readonly requests: RequestBuffer | undefined;
}

/**
 * The boot record for the application a request reached, opened on first sight
 * and answered from every time after.
 *
 * The record is per application rather than per registration, because a boot
 * reuses the dynamic module a module class was declared with: two applications
 * built from one module class are one registration, and a record held in one
 * variable would answer one application's traffic to the other's client.
 *
 * It is opened from the arrival hook as well as from the surface, and both call
 * sites are the same memoized entry: the window belongs to the boot, so opening
 * it when the surface is first polled would answer for the polling client and
 * drop every request the application answered before it. `beginBoot` is also
 * where the capture is associated with the boot's own exception table, which is
 * the only place an unhandled failure's message can come from, so it has to have
 * run before the first request this registration records is filed. It cannot be
 * an `onStart` call: `onStart` never fires for an application that only calls
 * `handle()`, so a record opened there would not exist for exactly the
 * applications this mount made reachable, and their captures would report an
 * empty window for traffic they really answered.
 *
 * An application no boot produced has no record to open and no boot's exception
 * table to file, so both stay absent: `createHandlers` serves no `/requests` for
 * a window that does not exist, rather than an empty one that would claim it
 * does.
 */
function recordFor(
  records: WeakMap<object, ApplicationRecord>,
  store: object,
  capture: RequestCapture,
): ApplicationRecord {
  const opened = records.get(store);

  if (opened !== undefined) {
    return opened;
  }

  const application = readApplicationFromStore(store) as Elysia | undefined;
  const diagnostics =
    application === undefined ? undefined : readApplicationDiagnostics(application);
  // One `beginBoot` per application: it opens the window and files the boot's
  // exception table, so a second call would replace the window the application
  // has been answering into.
  const requests =
    application === undefined ? undefined : capture.beginBoot(store, diagnostics?.mappedExceptions);
  const opening: ApplicationRecord = { application, requests };

  records.set(store, opening);

  return opening;
}

/**
 * The endpoints one application's surface answers with, built on the first
 * request that reaches it and answered from for every later one.
 *
 * The record is built once per application rather than per request, and that is
 * not only an economy: the payloads it answers with describe the application, so
 * a table re-read for every request is the difference between a report and a
 * snapshot. The store is the identity it is keyed by, for `recordFor`'s reason.
 */
function surfaceFor(
  surfaces: WeakMap<object, DevtoolsHandlers>,
  store: object,
  record: ApplicationRecord,
  logs: TappedLogStream | undefined,
): DevtoolsHandlers {
  const built = surfaces.get(store);

  if (built !== undefined) {
    return built;
  }

  const handlers = createHandlers(record.application, logs, record.requests, devtoolsLogger);

  surfaces.set(store, handlers);

  return handlers;
}

/**
 * The application's log stream for one registration, or `undefined` when this
 * registration has none to publish.
 *
 * The stream is built here, when the module is registered, and that is not a
 * detail a maintainer may tidy away into a hook: registration is the only moment
 * this package holds the application's logger that comes before the boot writes.
 * The lines a boot reports about itself — which graph served, which modules it
 * initialized, which routes it resolved — are written before any hook runs, so a
 * tap installed when a request arrives records none of them, and they are most of
 * what this stream is worth.
 *
 * Two outcomes, however many values arrive at the first one. A logger object the
 * tap could install on is tapped in place and its stream is published, and the
 * stream states the levels the tap reached, so a partly patched logger still
 * names what it covers. Everything else publishes no `/logs` at all: the option
 * omitted, `false`, any value that is not a logger — which a JavaScript caller can
 * pass whatever the type says — and a logger no level could be patched on, where
 * the tap installs nothing and a published stream would record nothing while that
 * logger goes on printing. The boundary is the count of levels patched rather than
 * the first refusal: a logger whose `log` refuses but whose `fatal` accepts is the
 * publishing outcome, and its stream names `fatal`. The endpoint states a stream,
 * and a registration with
 * none to state serves no endpoint, so the dispatcher's `404` is the answer, the
 * way a boot the record holds no compiled root for serves no `/graph`.
 *
 * `false` is not the empty stream it once answered, and the difference is the
 * whole reason: it states that the application has no logger object to hand over,
 * which is not the fact "nothing is being logged". An application that passes
 * `false` here and a logger to `AponiaFactory.create` — type-legal, and what
 * forwarding an option value looks like — logs normally, and a registration
 * cannot tell that logger from one the factory built for itself. An empty window
 * would announce the silence in exactly that case; absence is true in every one
 * of them.
 */
function createLogStream(source: DevtoolsOptions["logger"]): TappedLogStream | undefined {
  if (!isRecordableLogger(source)) {
    return undefined;
  }

  return tapLogBuffer(source, createLogBuffer(defaultLogBufferCapacity));
}
