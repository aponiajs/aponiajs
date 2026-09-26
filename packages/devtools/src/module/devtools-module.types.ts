import type { LoggerService } from "@aponiajs/common";

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
   * The loopback port the devtools server binds once it starts. Defaults to
   * `8000`. The bind address is not configurable; it is always `127.0.0.1`.
   */
  readonly port?: number;
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
   * A logger object earns the stream, and every other value serves no `/logs` at
   * all rather than an empty one, because absence is true in all of those cases
   * and an empty window is true in only one of them:
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
   *
   * The endpoint states a stream, and a registration with none to state serves no
   * endpoint — the dispatcher's `404`, the way a boot the record holds no compiled
   * root for serves no `/graph`.
   */
  readonly logger?: false | LoggerService;
}
