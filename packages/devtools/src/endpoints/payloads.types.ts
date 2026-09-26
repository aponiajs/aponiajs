import type {
  AponiaGatewayInspection,
  AponiaModuleInspection,
  AponiaRouteParameterInspection,
} from "@aponiajs/platform-elysia";
import type { LogEntry } from "../logging/log-buffer.types.ts";

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

/**
 * Which binding answers one mounted route, as the boot recorded it.
 *
 * `"generated"` is a build-time invoker: an artifact the boot adopted supplied
 * the binding for that route's handler. `"compiled"` is the running platform's
 * own: it compiled the route's parameter binding, or mounted a route a callback
 * built, which no artifact can reach. `null` is neither, and it means the boot
 * recorded nothing about this route at all — a native WebSocket route, a route a
 * plugin provides, or an application no boot produced. It never means "an
 * unknown binding": a report that published a guess where a state belongs would
 * make one boot's routes look interchangeable with another's.
 */
export type AponiaRouteSource = "generated" | "compiled" | null;

/**
 * One route the running application answers.
 *
 * The method, the path, and the parameter list come from the compiled plan the
 * boot recorded, while the entry itself comes from the mounted table — a server
 * that reported only the plans would miss every route a callback mounted, and
 * one that reported only the table would know no route's module, controller, or
 * handler. The three names are the join's whole contribution, and an empty one
 * states that no record describes this route rather than that the name is
 * unknown: a callback's route names its module and controller but never its
 * handler, because the property key that built it exists only while the callback
 * runs, and a route no plan and no callback describes names none of the three.
 *
 * Route entries are sorted by path, method, controller, handler, and module, in
 * code-unit order, so the payload is deterministic and two polls of one server
 * answer the same order.
 */
export interface AponiaMountedRoute {
  /**
   * The method the mounted table reports. A native WebSocket route reports
   * `"WS"`, which is a method the table carries rather than an HTTP verb.
   */
  readonly method: string;
  /** The path the mounted table reports, exactly as it mounted it. */
  readonly path: string;
  /** The id of the module that mounted the route, or `""` when none is recorded. */
  readonly module: string;
  /** The name of the controller that mounted the route, or `""` when none is recorded. */
  readonly controller: string;
  /**
   * The handler's property key as the platform projects it — `String(key)`, so a
   * symbol key reads as `Symbol(description)` — or `""` when no plan records one.
   */
  readonly handler: string;
  /** Which binding answers the route, or `null` when no boot recorded one. */
  readonly source: AponiaRouteSource;
  /**
   * The context fields the route's handler binds, in declaration order. Empty
   * for a route the recorded plans do not describe: a parameter list belongs to
   * a compiled plan, and a callback's routes carry none.
   */
  readonly parameters: readonly AponiaRouteParameterInspection[];
}

/**
 * The payload `/__devtools/routes` answers with: every route the application
 * answers, read from the mounted table when the request arrives.
 *
 * The table is the application's own, so this payload has no gating state: an
 * application no boot produced still answers with its routes, each of them
 * stating `null` for a binding no boot recorded. What a record does add is
 * everything a mounted route cannot say about itself — its module, its
 * controller, and the property key that serves it — which no entry of the
 * table keeps once the boot that mounted it has returned.
 */
export interface AponiaRoutesPayload {
  /** Every mounted route, sorted by path, method, controller, handler, and module. */
  readonly routes: readonly AponiaMountedRoute[];
}

/**
 * The payload `/__devtools/logs` answers with: the application's log stream read
 * from one cursor, and the cursor the next poll asks from.
 *
 * `cursor` counts every line the stream has recorded, including the ones dropped
 * since, which is what makes it usable as a poll marker: a client that keeps it
 * and passes it back sees every line written between two polls, however many
 * there were. It never goes backwards, whatever the request named — a `since`
 * older than the retained window is answered with the whole window, and one
 * ahead of every write with none — so a poll is never an error and never a
 * rewind.
 */
export interface AponiaLogsPayload {
  /** The cursor to pass back as `since` on the next poll. */
  readonly cursor: number;
  /** The retained entries written after the requested cursor, oldest first. */
  readonly entries: readonly LogEntry[];
}
