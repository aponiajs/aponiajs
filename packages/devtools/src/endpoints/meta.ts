import type { AponiaApplicationDiagnostics } from "@aponiajs/platform-elysia";
import { aponiaVersion } from "../version.ts";
import type { AponiaMetaPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsMetaPath = "/meta";

/**
 * The devtools wire contract this release speaks.
 *
 * It moved from `1` to `2` when a request entry gained `id`, `status` and
 * `durationMs` became nullable, and one request began writing two entries — a
 * change a reader of `1` cannot survive, because it would read a `null` status
 * as a number and count one request twice.
 *
 * It moved from `2` to `3` when `/meta`'s `startedAt` changed meaning: the
 * surface answers on the application's own route table now, so the field is
 * stamped when the surface first answers for an application rather than when a
 * socket was bound. No field was added or removed, and a reader of `2` has no
 * other signal — the shape it validates still parses and the timestamp it reads
 * is still an ISO-8601 string, while the moment it names is a different one.
 */
export const devtoolsContractVersion = 3;

/**
 * Builds the payload `/meta` answers with, once per boot.
 *
 * Every fact comes from what the boot recorded, or from this release. Two
 * projections need their rule stated rather than inferred:
 *
 * - `framework` falls back to this release for an application no boot produced
 *   — a plain `Elysia`, or one a caller composed by hand. The endpoint still
 *   answers, because a client that asked the surface what it is looking at
 *   deserves an answer rather than a `500`, and the fallback is true: this
 *   release is what is serving the report.
 * - `artifacts` reports the release each adopted artifact came from, exactly as
 *   the record states it, and `null` for one the boot did not adopt. The record,
 *   not this endpoint, is where that distinction lives: a hand-written
 *   `ModuleDefinition` a caller passed compiles as declared data, but no build
 *   emitted it, so its stamp stays `null` and this endpoint never invents one.
 *
 * `artifacts` is read through an optional chain although the record's type
 * declares the field, because the record is read through a registry-global
 * symbol key: a boot run by a copy of `@aponiajs/platform-elysia` older than
 * this release answers the same key with a record that has no `artifacts` at
 * all. A record missing the field reads the way one that adopted nothing does —
 * `null` — rather than throwing, because this builder runs inside a request
 * handler, where a throw is that request's failure.
 *
 * The payload is frozen and built once per application, when the surface first
 * answers for it: every later request is answered from the same report, so a
 * poll cannot observe a half-changed one.
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
      invokers: facts.diagnostics?.artifacts?.invokers ?? null,
      descriptors: facts.diagnostics?.artifacts?.descriptors ?? null,
    }),
    startedAt: facts.startedAt,
  });
}
