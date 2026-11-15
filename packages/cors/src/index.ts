/**
 * `@aponiajs/cors` — answer cross-origin requests for an application.
 *
 * The package wraps [`@elysia/cors`](https://www.npmjs.com/package/@elysia/cors).
 * It adds no CORS implementation: the headers, the preflight handling, and the
 * header values are the plugin's own, and what this package contributes is a
 * module the registration belongs in and a validated configuration the policy is
 * read from. An application that wants the raw plugin, or that needs an origin
 * this package's configuration cannot carry, should install `@elysia/cors`
 * directly.
 */
export { CorsModule } from "./module/cors-module.ts";
export type { CorsModuleOptions } from "./module/cors-module.types.ts";
export type { CorsConfiguration } from "./policy/cors-policy.types.ts";
