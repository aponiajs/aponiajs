import type { AponiaGatewayInspection, AponiaModuleInspection } from "@aponiajs/platform-elysia";

/**
 * Which release supplied each artifact a boot adopted.
 *
 * `null` states that the boot adopted no such artifact; it never means "an
 * unknown release". A report that published a guess where a release belongs
 * would make one boot's data look interchangeable with another's.
 */
export interface AponiaArtifactStamps {
  /** The release that generated the invokers the boot adopted, or `null`. */
  readonly invokers: string | null;
  /** The release that generated the module descriptors the boot adopted, or `null`. */
  readonly descriptors: string | null;
}

/**
 * The payload `/__devtools/meta` answers with.
 *
 * A reader checks `contract` first: it is the version of this wire shape, which
 * moves when a field changes meaning, while `framework` names the release that
 * produced the data being read. The two are independent on purpose — a devtools
 * release can read an older boot, and has to say which one it read.
 */
export interface AponiaMetaPayload {
  /** The devtools wire contract this payload is written in. */
  readonly contract: 1;
  /**
   * The AponiaJS release that booted the application, or — when no boot
   * produced it — the release serving this payload.
   */
  readonly framework: string;
  /** The Elysia release the running package resolved, or `null` when none did. */
  readonly elysia: string | null;
  /** Which release supplied each artifact the boot adopted. */
  readonly artifacts: AponiaArtifactStamps;
  /** The moment the devtools server started, as an ISO-8601 timestamp. */
  readonly startedAt: string;
}

/**
 * The payload `/__devtools/graph` answers with: the compiled module graph, in
 * the shape the inspection projection describes it.
 *
 * The one field the inspection carries and this payload does not is `routes`,
 * and it is absent rather than empty. A compiled plan states the routes a
 * controller *declares*, while `/routes` reports the routes the server
 * *answers*; publishing both under one name would leave a consumer choosing
 * between two answers to the same question, so routes belong to that endpoint
 * alone.
 */
export interface AponiaGraphPayload {
  /** The id of the root module the boot compiled. */
  readonly rootModule: string;
  /** Every module of the compiled graph, in graph order. */
  readonly modules: readonly AponiaModuleInspection[];
  /** Every gateway the compiled graph registers, sorted by canonical path. */
  readonly gateways: readonly AponiaGatewayInspection[];
}
