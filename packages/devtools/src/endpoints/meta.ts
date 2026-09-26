import type { AponiaApplicationDiagnostics } from "@aponiajs/platform-elysia";
import { aponiaVersion } from "../version.ts";
import type { AponiaMetaPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsMetaPath = "/meta";

/** The devtools wire contract this release speaks. */
export const devtoolsContractVersion = 1;

/**
 * Builds the payload `/meta` answers with, once per boot.
 *
 * Every fact comes from what the boot recorded, or from this release. Two
 * projections need their rule stated rather than inferred:
 *
 * - `framework` falls back to this release for an application no boot produced
 *   — a plain `Elysia`, or one a caller composed by hand. The endpoint still
 *   answers, because a client that asked a devtools server what it is looking at
 *   deserves an answer rather than a `500`, and the fallback is true: this
 *   release is what is serving the report.
 * - `artifacts` reports the release each adopted artifact came from, exactly as
 *   the record states it, and `null` for one the boot did not adopt. The record,
 *   not this endpoint, is where that distinction lives: a hand-written
 *   `ModuleDefinition` a caller passed compiles as declared data, but no build
 *   emitted it, so its stamp stays `null` and this endpoint never invents one.
 *
 * The payload is frozen and built once: every request of one boot is answered
 * from the same report, so a poll cannot observe a half-changed one.
 */
export function buildMetaPayload(facts: {
  readonly diagnostics: AponiaApplicationDiagnostics | undefined;
  readonly elysia: string | null;
  readonly startedAt: string;
}): AponiaMetaPayload {
  const framework = facts.diagnostics?.framework ?? aponiaVersion;

  return Object.freeze({
    contract: devtoolsContractVersion,
    framework,
    elysia: facts.elysia,
    artifacts: Object.freeze({
      invokers: facts.diagnostics?.artifacts.invokers ?? null,
      descriptors: facts.diagnostics?.artifacts.descriptors ?? null,
    }),
    startedAt: facts.startedAt,
  });
}
