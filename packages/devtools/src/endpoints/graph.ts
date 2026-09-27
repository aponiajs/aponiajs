import {
  compileRootModule,
  inspectAponiaApplication,
  type AponiaApplicationDiagnostics,
} from "@aponiajs/platform-elysia";
import type { AponiaGraphPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsGraphPath = "/graph";

/**
 * Builds the payload `/graph` answers with, once per boot, or `undefined` when
 * the boot record holds no graph this release can describe.
 *
 * The graph is the one the boot compiled, never the decorated classes the
 * application named. The record's `rootModule` is the root `compileRootModule`
 * already returned, so lowering it again answers that same descriptor, and the
 * projection is `inspectAponiaApplication` — the same function `bun run inspect`
 * uses. The two therefore cannot disagree: the projection resolves its root
 * through the selector, which substitutes only a class or a dynamic module, so a
 * descriptor handed to it is the graph itself.
 *
 * `routes` is dropped rather than emptied, key and all: the plans state what a
 * controller declares while `/routes` reports what the server answers, and
 * routes belong to that endpoint alone. `modules` and `gateways` are the
 * projection's own frozen arrays for the same reason `rootModule` is its id —
 * this endpoint publishes what inspection reads, and restating any of it here
 * would be the second implementation of one projection.
 *
 * `rootModule` is read through an optional chain although the record's type
 * declares the field, and the projection is guarded, because the record is read
 * through a registry-global symbol key: a boot run by a copy of
 * `@aponiajs/platform-elysia` that predates this field answers the same key with
 * a record that has none, and one run by a copy newer than this release can
 * answer a compiled root this release cannot lower. Both read as a boot with no
 * graph to report — what the server serves no `/graph` for — rather than throw,
 * since this builder runs inside the plugin's `onStart`, which Elysia neither
 * awaits nor catches, so a throw here takes `listen()` with it.
 */
export function buildGraphPayload(
  diagnostics: AponiaApplicationDiagnostics | undefined,
): AponiaGraphPayload | undefined {
  const rootModule = diagnostics?.rootModule;

  if (rootModule === undefined) {
    return undefined;
  }

  try {
    const inspection = inspectAponiaApplication(compileRootModule(rootModule));

    return Object.freeze({
      rootModule: inspection.rootModule,
      modules: inspection.modules,
      gateways: inspection.gateways,
    });
  } catch {
    // A record a foreign copy wrote compiles as a foreign graph, and the boot
    // this endpoint reports on already compiled its own: a failure here can only
    // mean the record is not this release's to project.
    return undefined;
  }
}
