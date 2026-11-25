import { Module, dynamicModule, provideFactory, type DynamicModule } from "@aponiajs/common";
import {
  APPLICATION_CONTAINER,
  provideConfiguration,
  requirePlatformCapabilities,
  type ApplicationContainerRef,
} from "@aponiajs/platform-core";
import {
  createOpenApiController,
  OPENAPI_RUNTIME,
  type OpenApiRuntime,
} from "./document/openapi.controller.ts";
import { readOpenApiInfo } from "./document/openapi-document.ts";
import type { OpenApiModuleOptions } from "./interfaces/openapi-module.interface.ts";

const defaultKey = "openapi";
const defaultPath = "/openapi";

/**
 * One controller class per registration identity.
 *
 * Two registrations that share a key are one module identity, and a graph
 * refuses them before either mounts. Reusing the generated class is what lets
 * that refusal be the module's rather than a duplicate-route refusal from two
 * identical classes.
 */
const controllers = new Map<string, ReturnType<typeof createOpenApiController>>();

function controllerFor(mountPath: string, key: string): ReturnType<typeof createOpenApiController> {
  const identity = `${key}:${mountPath}`;
  let controller = controllers.get(identity);
  if (controller === undefined) {
    controller = createOpenApiController(mountPath);
    controllers.set(identity, controller);
  }
  return controller;
}

/**
 * The module an application imports to serve an OpenAPI document for its own
 * routes.
 *
 * ```ts
 * const document = OpenApiModule.register({ configuration: OpenApiConfig });
 *
 * @Module({ imports: [document] })
 * export class AppModule {}
 * ```
 *
 * The document is built from the compiled route plans the application declared
 * and served by a controller, so the same registration answers the same
 * document on every platform.
 */
@Module({})
export class OpenApiModule {
  /**
   * Builds the OpenAPI module for one application.
   *
   * @param options - The configuration, literal source, mount path, and module key.
   * @returns A frozen registration the application's `imports` accepts.
   */
  static forRoot(options: OpenApiModuleOptions): DynamicModule {
    const { configuration, source, key, path } = options;
    const documentPath = path ?? defaultPath;
    const moduleKey = key ?? defaultKey;

    assertDocumentPath(documentPath);

    return dynamicModule({
      module: OpenApiModule,
      id: `OpenApiModule[${moduleKey}]`,
      instanceId: Symbol.for(`aponia.openapi:${moduleKey}`),
      providers: [
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideFactory(
          OPENAPI_RUNTIME,
          [configuration, APPLICATION_CONTAINER],
          (value: unknown, container: ApplicationContainerRef): OpenApiRuntime =>
            Object.freeze({
              info: readOpenApiInfo(value, configuration),
              mountPath: documentPath,
              container: () => container.current,
            }),
        ),
        requirePlatformCapabilities("openapi", ["http"]),
      ],
      controllers: [controllerFor(documentPath, moduleKey)],
      exports: [configuration],
    });
  }

  /**
   * Builds the OpenAPI module for one application.
   *
   * @deprecated Use {@link OpenApiModule.forRoot}; retained for the beta line.
   */
  static register(options: OpenApiModuleOptions): DynamicModule {
    return OpenApiModule.forRoot(options);
  }
}

/**
 * Refuses a mount path that is not an absolute path, while the registration
 * runs.
 */
function assertDocumentPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError('An OpenAPI document path must be an absolute path such as "/openapi".');
  }
}
