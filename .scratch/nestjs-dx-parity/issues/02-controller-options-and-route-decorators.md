# Controller Options, HttpStatus, and Route Decorators

Type: grilling
Status: open

## Question

Settle the exact cross-platform contracts (Elysia, Hono, H3) for NestJS 1:1 controller and routing semantics:

1. **`@Post()` default `201 Created`**: Confirm precedence when `@HttpCode()`, `@Redirect()`, `@Res()` / `@ResponseSettings()`, or an explicit `Response` return overrides the `201` default on `POST` routes across Elysia, Hono, and H3 (and list existing test assertions to update).
2. **`@Controller(...)` & multi-path routes**: What exact `ControllerOptions` fields (`path?: string | string[]`, `host?: string | RegExp | readonly (string | RegExp)[]`, `scope?: ProviderScope`, `version?: VersionValue | readonly VersionValue[]`) should lower into `ControllerMetadata` / `ControllerDefinition`, how should host parameter matching (`:account.example.com`) compose with `@HostParam()` and route uniqueness checks, and how do `string[]` paths on `@Get(['a', 'b'])` work?
3. **`HttpStatus` & `@Session()`**: Verify TypeScript value+type exports for `HttpStatus` (`export const HttpStatus` + `export type HttpStatus = HttpStatusCode`) alongside existing `@HttpStatus()` callers, and decide how `@Session()` in `@aponiajs/common` bridges cleanly with `@aponiajs/session`.
4. **`@Redirect()`, `@Res({ passthrough?: boolean })`, `@Next()`, & Versioning/Prefix**: Define exact interaction between `@Redirect(url?, statusCode?)` (and dynamic `{ url, statusCode }`), non-passthrough `@Res()` (suppressing framework auto-serialization vs passthrough mode with `@HttpCode`/`@Header`/`StreamableFile`), `setGlobalPrefix('api', { exclude })`, and `@Version(VersionValue[])` / `enableVersioning({ defaultVersion, prefix: false })`.
