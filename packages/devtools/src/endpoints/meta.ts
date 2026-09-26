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
 * - `artifacts` stamps the release that supplied an artifact the boot adopted,
 *   and `null` for one it did not. The record proves adoption — the invoker
 *   verdict, and a declared graph for descriptors — but not which release
 *   emitted the artifact, so this projects from what it does prove instead of
 *   re-applying a platform selector's rules here. A declared graph a caller
 *   handed over by hand reads as a declared graph, so its descriptor stamp is
 *   this release as well: the boot served declared data, and the caller wrote it.
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
      invokers: facts.diagnostics?.invokers.accepted === true ? framework : null,
      descriptors: facts.diagnostics?.graph === "declared" ? framework : null,
    }),
    startedAt: facts.startedAt,
  });
}
