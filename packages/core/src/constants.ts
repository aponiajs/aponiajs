/**
 * The application-enhancer tokens `@aponiajs/core` republishes.
 *
 * Nest defines `APP_*` in its core package. The one-way `common` ← `core`
 * dependency direction fixes their definition in `@aponiajs/common`, so this
 * module is where core states them as its own public surface.
 */
export { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@aponiajs/common";
