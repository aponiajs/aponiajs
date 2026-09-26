import type { LoggerService } from "@aponiajs/common";

/**
 * What one registration records about the requests the application answers.
 *
 * Every option is an opt-out rather than a permission: a registration that names
 * none of them records the method, the route pattern that matched, the URL as it
 * arrived, the status, the duration, the arrival time, the request's headers, and
 * the request body the route parsed. A development tool that required two opt-ins
 * before it showed a header is one nobody opens.
 */
export interface DevtoolsCaptureOptions {
  /** Record requests at all. Default true. */
  readonly enabled?: boolean;
  /** Include request headers. Default true. */
  readonly headers?: boolean;
  /** Include the parsed request body. Default true. */
  readonly body?: boolean;
  /** Maximum characters stored for a body. Default 16384. */
  readonly bodyLimit?: number;
  /**
   * Header names to replace with the literal "[redacted]" before an entry is
   * stored. Empty by default: the tool shows what arrived. Set it when the
   * application is pointed at data that is not yours.
   */
  readonly redact?: readonly string[];
}

/**
 * The application's opt-in decision for `@aponiajs/devtools`.
 */
export interface DevtoolsOptions {
  /**
   * Whether the application mounts the devtools plugin. Registration is the
   * opt-in and this is the switch: the framework never guesses the answer from
   * an environment variable on the application's behalf.
   */
  readonly enabled: boolean;
  /**
   * The port the devtools server binds once it starts. Defaults to `8000`, on
   * the address `host` names.
   */
  readonly port?: number;
  /**
   * The address the devtools server binds once it starts. Defaults to
   * `127.0.0.1`, because a debugging aid should not be reachable by default.
   *
   * The option exists because loopback is not always where the reader is: a
   * container that publishes its port, a remote development box, and a phone on
   * the same network are all real cases, and none of them is served by a bind
   * only the machine itself can reach.
   *
   * Widening the bind is permitted and never silent. The start reports one row
   * under `Devtools` naming this option, the address it bound, and `/requests`,
   * because that endpoint records request headers and bodies **by default**:
   * binding it where the network can reach it puts credentials on the network,
   * and a row that said only "reachable from the network" would leave the
   * reader to guess that. `127.0.0.1`, any `127.x.x.x`, `::1`, and
   * `localhost` are the loopback spellings the warning is skipped for — the
   * check names them rather than resolving anything, so a hostname that points
   * at loopback still warns.
   */
  readonly host?: string;
  /**
   * The logger whose lines `/__devtools/logs` records: pass the **same** value
   * the application gives `AponiaFactory.create`.
   *
   * That is the condition this option states rather than hides: the framework
   * holds the one object it was given and never exposes the logger it may build
   * for itself, so a logger that only reaches the factory is one no devtools
   * registration can record from. The object is patched in place and never
   * replaced: every line it already printed is still printed, in the same order,
   * through the same object the application holds, and a second registration
   * naming the same logger is published the stream that is already recording
   * rather than a second one.
   *
   * The stream starts when the module registers, which is before the boot writes
   * anything, so the lines a boot reports about itself — the graph it served, the
   * modules it initialized, the routes it resolved — are in it.
   *
   * A logger object the tap can install on earns the stream, and every other
   * value — or a logger it cannot patch — serves no `/logs` at all rather than an
   * empty one, because absence is true in all of those cases and an empty window
   * is true in only one of them:
   *
   * - `false` — the value that turns the application's logging off — states that
   *   the application has no logger object to hand over. That is not the same
   *   fact as "nothing is being logged"; an application that passes `false` here
   *   and a logger to `AponiaFactory.create` logs normally, and this registration
   *   cannot tell that logger from one the factory built for itself.
   * - Omitting the option states the same absence.
   * - An array of levels — the other value the factory accepts — tells the
   *   platform to build a logger of its own, which the application never holds,
   *   so an application that names one has nothing to hand over either. The type
   *   does not accept it; a JavaScript caller can pass it anyway, which is why
   *   the value is checked rather than trusted.
   * - A logger object whose first assignment refuses — a frozen one refuses them
   *   all — is the same absence. It is patched in place, so a refusal that lands
   *   before any level was patched means the logger records nothing, and a
   *   published stream would answer `{ cursor: 0, entries: [] }` while that logger
   *   goes on printing every line: the same false silence, so it earns no endpoint
   *   either. A refusal later than that is not this case — a level was patched, so
   *   the stream is published and records the levels the tap reached.
   *
   * The endpoint states a stream, and a registration with none to state serves no
   * endpoint — the dispatcher's `404`, the way a boot the record holds no compiled
   * root for serves no `/graph`.
   */
  readonly logger?: false | LoggerService;
  /**
   * What this registration records about the requests the application answers.
   * Every option is an opt-out; `false` is shorthand for `{ enabled: false }`.
   *
   * The record is the application's own traffic, and two facts about it are
   * stated rather than softened:
   *
   * - A token passed as a query parameter is captured in `url`. That is a fact
   *   about the record rather than a defect in it — `url` is the path and query
   *   string as they arrived, because a pattern never carries one — and `redact`
   *   is the answer for an application pointed at traffic that is not a
   *   development environment's.
   * - A request refused before a route matched is recorded, and the record says
   *   so: `path` carries the path that arrived rather than a pattern, and
   *   `/routes` is the table that tells the two apart.
   *
   * Unlike `logger`, there is no value here the registration cannot reach: the
   * requests are the application's own, so a registration that captures nothing
   * still serves `/requests`, answering an empty record with cursor `0` rather
   * than no endpoint. "This registration was told to record nothing" is itself a
   * fact the record states.
   *
   * The record is one boot's: it opens when the boot starts and holds what that
   * boot answers, so a second `listen()` begins a new one rather than extending a
   * window whose socket is gone.
   */
  readonly capture?: false | DevtoolsCaptureOptions;
}
