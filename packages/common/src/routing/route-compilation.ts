import { getDeprecationMetadata } from "./deprecation.ts";
import { getEnhancerMetadata } from "../enhancers/enhancer.decorator.ts";
import { getHttpCode, getResponseHeaders } from "./response-metadata.ts";
import { getPipesMetadata } from "../pipes/pipe.decorator.ts";
import { getResponseSerializer } from "./response-serializer.ts";
import { getRouteMetadata } from "../decorators/decorators.ts";
import { getRouteParameterMetadata } from "./route-parameters.ts";
import { getVersionMetadata, versionPathSegment } from "./versioning.ts";
import { getViewOptions, getViewTemplate } from "./view.ts";
import { isSseRoute } from "./sse.ts";
import { type ClassToken } from "../interfaces/token.interface.ts";
import { type EnhancerMetadata } from "../interfaces/enhancer-decorators.interface.ts";
import type { CompiledRoute } from "../interfaces/compiled-route.interface.ts";
import { joinPaths } from "./route-path.ts";

/**
 * Lowers one controller's decorated routes into the frozen data a platform
 * mounts.
 *
 * Controller-scope and handler-scope declarations are joined the way the
 * runtime runs them: guards and interceptors put the class's own first, filters
 * put the handler's first. The route path carries its version prefix, so a
 * route's identity includes the version it answers on.
 *
 * @param controller - The decorated controller class.
 * @param controllerPath - The prefix `@Controller()` declared.
 * @returns One frozen route per HTTP method decorator, in declaration order.
 */
export function compileRoutes(
  controller: ClassToken<unknown>,
  controllerPath: string,
): readonly CompiledRoute[] {
  const controllerEnhancers = getEnhancerMetadata(controller);
  const controllerPipes = getPipesMetadata(controller) ?? [];

  const routes = getRouteMetadata(controller).map((route): CompiledRoute => {
    const parameters = getRouteParameterMetadata(controller, route.propertyKey);
    const methodPipes = getPipesMetadata(controller.prototype, route.propertyKey) ?? [];
    const pipes = Object.freeze([...controllerPipes, ...methodPipes]);
    const parameterTypes = Reflect.getMetadata(
      "design:paramtypes",
      controller.prototype,
      route.propertyKey,
    ) as readonly unknown[] | undefined;
    const version =
      getVersionMetadata(controller.prototype, route.propertyKey) ?? getVersionMetadata(controller);
    const responseHeaders = getResponseHeaders(controller, route.propertyKey);
    const httpCode = getHttpCode(controller, route.propertyKey);
    const joined = joinPaths(controllerPath, route.path);
    const path =
      typeof version === "string" ? joinPaths(versionPathSegment(version), joined) : joined;
    const template = getViewTemplate(controller.prototype, route.propertyKey);
    const viewOptions =
      template === undefined ? undefined : getViewOptions(controller.prototype, route.propertyKey);
    const deprecation =
      getDeprecationMetadata(controller.prototype, route.propertyKey) ??
      getDeprecationMetadata(controller);

    return Object.freeze({
      method: route.method,
      path,
      propertyKey: route.propertyKey,
      parameters,
      schema: route.schema,
      declaredParameterCount: parameterTypes?.length,
      pipes,
      enhancers: mergeEnhancerMetadata(
        controllerEnhancers,
        getEnhancerMetadata(controller, route.propertyKey),
      ),
      serializer:
        getResponseSerializer(controller.prototype, route.propertyKey) ??
        getResponseSerializer(controller),
      ...(typeof version === "string" ? { version } : {}),
      ...(isSseRoute(controller.prototype, route.propertyKey) || isSseRoute(controller)
        ? { sse: true as const }
        : {}),
      ...(template === undefined
        ? {}
        : {
            view: Object.freeze({
              template,
              ...(viewOptions === undefined ? {} : { options: viewOptions }),
            }),
          }),
      ...(responseHeaders === undefined ? {} : { responseHeaders }),
      ...(httpCode === undefined ? {} : { httpCode }),
      ...(deprecation === undefined ? {} : { deprecation }),
    });
  });

  return Object.freeze(routes);
}

function mergeEnhancerMetadata(
  controllerScope: EnhancerMetadata,
  handlerScope: EnhancerMetadata,
): EnhancerMetadata {
  return Object.freeze({
    guards: Object.freeze([...controllerScope.guards, ...handlerScope.guards]),
    interceptors: Object.freeze([...controllerScope.interceptors, ...handlerScope.interceptors]),
    filters: Object.freeze([...handlerScope.filters, ...controllerScope.filters]),
  });
}
