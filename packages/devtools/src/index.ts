/**
 * The opt-in devtools surface for an AponiaJS application.
 *
 * The package is a leaf: nothing in the framework depends on it, and an
 * application imports it deliberately. `DevtoolsModule.register({ enabled })`
 * is the whole opt-in — a disabled registration mounts nothing at all.
 */
export { DevtoolsModule } from "./module/devtools-module.ts";
export type { DevtoolsOptions } from "./module/devtools-module.types.ts";
