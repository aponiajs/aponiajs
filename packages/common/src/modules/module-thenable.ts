import type { ModuleImport } from "../interfaces/decorators.interface.ts";

/**
 * Whether a module import is a thenable a boot still has to await.
 *
 * A dynamic registration may itself be a `Promise<DynamicModule>` — Nest's
 * `ConfigModule.forRoot()` is one — so the compiler must tell a promise apart
 * from a registration before it reads `module` off it.
 *
 * @param entry - Any value a module's `imports` list may hold.
 * @returns Whether the value is a thenable.
 */
export function isThenableModuleImport(entry: unknown): entry is Promise<ModuleImport> {
  return (
    (typeof entry === "object" || typeof entry === "function") &&
    entry !== null &&
    typeof (entry as { readonly then?: unknown }).then === "function"
  );
}
