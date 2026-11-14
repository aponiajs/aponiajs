/**
 * `@aponiajs/openapi` — serve an OpenAPI document for an application's routes.
 *
 * The package wraps `@elysia/openapi`. It adds no schema generator: the
 * document's paths, operations, and schemas are the plugin's own reading of the
 * route table the platform compiled, and what this package contributes is a
 * module the registration belongs in and a validated configuration the
 * document's own metadata is read from. An application that wants the raw
 * plugin should install `@elysia/openapi` directly.
 */
export { OpenApiModule } from "./module/openapi-module.ts";
export type { OpenApiModuleOptions } from "./module/openapi-module.types.ts";
export type { OpenApiConfiguration, OpenApiInfo } from "./document/openapi-document.types.ts";
