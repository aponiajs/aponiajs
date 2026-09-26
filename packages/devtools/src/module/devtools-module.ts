import { Logger, Module, type DynamicModule } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
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
 * `onStop` — which Elysia fires on `close()`, for a plugin as much as for the
 * application that mounted it — stops the socket the plugin started. A devtools
 * server that outlived its application would keep the port bound for a restart
 * that cannot take it, and the handle is the plugin's because the plugin is what
 * opened the socket.
 */
function createDevtoolsPlugin(options: DevtoolsOptions): Elysia {
  let server: DevtoolsServer | undefined;

  return new Elysia({ name: devtoolsPluginName })
    .onStart((application) => {
      const started = startDevtoolsServer({
        application,
        port: options.port,
        logger: devtoolsLogger,
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
