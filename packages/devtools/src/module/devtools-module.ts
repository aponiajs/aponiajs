import { Logger, Module, type DynamicModule } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { createLogBuffer, defaultLogBufferCapacity } from "../logging/log-buffer.ts";
import type { LogBuffer } from "../logging/log-buffer.types.ts";
import { isRecordableLogger, tapLogBuffer } from "../logging/log-tap.ts";
import { startDevtoolsServer } from "../server/devtools-server.ts";
import type { DevtoolsServer } from "../server/devtools-server.types.ts";
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
   * registers the devtools plugin as an `ElysiaPluginModule`, so the plugin
   * runs at `onStart`, after every route has mounted.
   */
  static register(options: DevtoolsOptions): DynamicModule {
    if (!options.enabled) {
      return createInertModule();
    }

    return ElysiaPluginModule.register(createDevtoolsPlugin(options), { key: devtoolsPluginKey });
  }
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
 * The plugin starts the devtools server at `onStart`, which Elysia runs once the
 * application is listening and every route has mounted. That is why the module
 * is a plugin module rather than a plain provider: a provider is constructed
 * before any controller mounts and cannot see the route table.
 *
 * The application `onStart` receives is the root one, so the boot record it
 * carries is what the report describes, and the address the plugin reports is
 * the one the socket actually took rather than the port configuration asked
 * for. A server that could not bind has already reported why, so the plugin
 * reports nothing further.
 *
 * The log stream is built before the plugin is, at registration, so it records
 * what the boot wrote about itself and not only what the application wrote once
 * it was serving. That timing is why it lives here rather than in the server
 * `onStart` builds — `createLogStream` states it from the stream's side. It
 * outlives every socket the plugin starts: a second `listen()` re-runs `onStart`
 * with the same stream, so the lines written in between are retained rather than
 * lost with the socket that was replaced.
 *
 * `onStop` — which Elysia fires on `close()`, for a plugin as much as for the
 * application that mounted it — stops the socket the plugin started. A devtools
 * server that outlived its application would keep the port bound for a restart
 * that cannot take it, and the handle is the plugin's because the plugin is what
 * opened the socket.
 */
function createDevtoolsPlugin(options: DevtoolsOptions): Elysia {
  let server: DevtoolsServer | undefined;
  const logs = createLogStream(options.logger);

  return new Elysia({ name: devtoolsPluginName })
    .onStart((application) => {
      const started = startDevtoolsServer({
        application,
        port: options.port,
        logger: devtoolsLogger,
        logs,
      });

      // A second `listen()` re-runs `onStart` while the socket the first one
      // started is still held, so only a start that succeeded becomes the
      // handle: assigning the `undefined` a refused bind answers would leave the
      // running socket with nothing left to stop it. The socket being replaced
      // is stopped as it is replaced, so the plugin owns exactly one devtools
      // server at a time and `onStop` always stops the live one.
      if (started === undefined) {
        return;
      }

      server?.stop();
      server = started;
      devtoolsLogger.log(`Aponia devtools is enabled for ${started.url}.`);
    })
    .onStop(() => {
      // The handle is dropped as well as stopped, so a later `listen()` starts a
      // fresh socket rather than leaving a stopped one behind.
      server?.stop();
      server = undefined;
    });
}

/**
 * The application's log stream for one registration, or `undefined` when this
 * registration has none to publish.
 *
 * The stream is built here, when the module is registered, and that is not a
 * detail a maintainer may tidy away into `onStart`: registration is the only
 * moment this package holds the application's logger that comes before the boot
 * writes. The lines a boot reports about itself — which graph served, which
 * modules it initialized, which routes it resolved — are written before `onStart`
 * runs, so a tap installed when the socket starts records none of them, and they
 * are most of what this stream is worth.
 *
 * Two outcomes, however many values arrive at the first one. A logger object the
 * tap could install on is tapped in place and its stream is published. Everything
 * else publishes no `/logs` at all: the option omitted, `false`, any value that is
 * not a logger — which a JavaScript caller can pass whatever the type says — and a
 * logger whose first assignment refuses, where the tap installs nothing and a
 * published stream would record nothing while that logger goes on printing. The
 * endpoint states a stream, and a registration with none to state serves no
 * endpoint, so the dispatcher's `404` is the answer, the way a boot the record
 * holds no compiled root for serves no `/graph`.
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
function createLogStream(source: DevtoolsOptions["logger"]): LogBuffer | undefined {
  if (!isRecordableLogger(source)) {
    return undefined;
  }

  return tapLogBuffer(source, createLogBuffer(defaultLogBufferCapacity));
}
