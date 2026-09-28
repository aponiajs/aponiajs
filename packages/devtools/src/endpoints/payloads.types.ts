import type {
  AponiaGatewayInspection,
  AponiaModuleInspection,
  AponiaRouteParameterInspection,
} from "@aponiajs/platform-elysia";
import type { LogEntry } from "../logging/log-buffer.types.ts";
import type { RequestRecord } from "../requests/request-buffer.types.ts";

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
 *
 * It is `2` as of this release. A request entry gained `id`, `status` and
 * `durationMs` became nullable, and one request began writing two entries, so a
 * reader written against `1` would read a status of `null` as a number and would
 * count a request twice.
 */
export interface AponiaMetaPayload {
  /** The devtools wire contract this payload is written in. */
  readonly contract: 2;
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
 * built, which no artifact can reach. `null` is neither: it is what a boot that
 * recorded no binding this release can name answers with — nothing about this
 * route at all, which is a native WebSocket route, a route a plugin provides, or
 * an application no boot produced, or a value under that field that is not one of
 * the three this release writes, which a foreign copy of the platform can state.
 * It never means "an unknown binding": a report that published a guess, or a
 * foreign state, where a decided state belongs would make one boot's routes look
 * interchangeable with another's.
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
  /**
   * Which binding answers the route, or `null` when the record states none this
   * release can name — no binding at all, or a value outside the three it writes,
   * which a foreign copy of the platform can state.
   */
  readonly source: AponiaRouteSource;
  /**
   * The context fields the route's handler binds, in declaration order. Empty
   * for a route the recorded plans do not describe: a parameter list belongs to
   * a compiled plan, and a callback's routes carry none. An entry the record
   * states in a shape this release does not write — no index that is a number,
   * no kind the decorators declare — is dropped rather than published, so a
   * foreign entry costs a parameter and not the list.
   */
  readonly parameters: readonly AponiaRouteParameterInspection[];
}

/**
 * The payload `/__devtools/routes` answers with: every route the application
 * answers, read from the mounted table when the request arrives.
 *
 * The table is the application's own, so this payload has no gating state: an
 * application no boot produced still answers with its routes, each of them
 * stating `null` for a binding no boot recorded — the answer for a value outside
 * the three this release writes as well. What a record does add is
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
 * from one cursor, the cursor the next poll asks from, and the levels the stream
 * records.
 *
 * `cursor` counts every line the stream has recorded, including the ones dropped
 * since, which is what makes it usable as a poll marker: a client that keeps it
 * and passes it back sees every line written between two polls, however many
 * there were. It never goes backwards, whatever the request named — a `since`
 * older than the retained window is answered with the whole window, and one
 * ahead of every write with none — so a poll is never an error and never a
 * rewind.
 *
 * `entries` states only the level each line was written at, so the level list is
 * the half that says which levels this stream can hold at all. The tap is
 * installed per level, and a level it could not reach is a silence this payload
 * states rather than one a client has to guess at.
 */
export interface AponiaLogsPayload {
  /** The cursor to pass back as `since` on the next poll. */
  readonly cursor: number;
  /** The retained entries written after the requested cursor, oldest first. */
  readonly entries: readonly LogEntry[];
  /**
   * The `LoggerService` levels this stream records, as the tap reached them.
   *
   * A logger that declared no `debug`, or whose `debug` property refused the
   * patch, is stated here rather than left to be inferred from an absence in
   * `entries`: a stream that never holds a `debug` line and a stream whose tap
   * never reached `debug` are different facts, and only this field tells them
   * apart.
   */
  readonly levels: readonly string[];
}

/**
 * The payload `/__devtools/requests` answers with: the entries the record wrote
 * after one cursor, and the cursor the next poll asks from.
 *
 * A request appears once when it arrived and again when it was answered, and
 * both entries carry the same `id`, so a consumer groups by `id` and takes the
 * last entry each request has in the window it reads — the answer wherever the
 * answer is still there to read. One configuration is where it is not: a
 * consumer lagging more than one window behind never reads an answer the bounded
 * record has already evicted. An entry whose `status` is
 * `null` is a request this record saw arrive and read no answer for — a plugin
 * that answered from its own `onRequest` before any later phase ran, or an answer
 * outside the window the consumer read. The absence is stated rather
 * than filled: an entry written at completion alone would make that request
 * indistinguishable from one that never arrived. The entry carries the path that
 * arrived rather than a pattern, because no route has matched at that point; the
 * answer's entry supersedes it with the pattern when one matched.
 *
 * It is `/logs`' cursor rules over a different record, down to the cursor's
 * meaning — which counts every entry the record has written, including the ones
 * dropped since, and so counts two per answered request — so a client that polls
 * one endpoint already knows how to poll the other, and a `since` outside the
 * retained window is answered with what is retained rather than an error. It
 * carries no `levels`: a request has no level, and only the log stream has levels
 * to name.
 *
 * Every other endpoint publishes what the application **is**; this one publishes
 * what it **did**. The record is in memory, per boot, and bounded like every
 * other payload here: a restart is a new record, and the capacity is what a
 * forgotten consumer can cost.
 */
export interface AponiaRequestsPayload {
  /** The cursor to pass back as `since` on the next poll. */
  readonly cursor: number;
  /** The retained entries recorded after the requested cursor, oldest first. */
  readonly entries: readonly RequestRecord[];
}
