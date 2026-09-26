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
   * `false` — the value that turns the application's logging off — states that
   * there is no logging to record. `/logs` then answers an empty stream rather
   * than being absent, because the application has decided, and an empty stream
   * is what that decision looks like from a client. Omitting the option states
   * that no logger was published at all, and the devtools server serves no
   * `/logs`: the endpoint states a stream, and this registration has none to
   * hand over.
   *
   * An array of levels — the other value the factory accepts — is not accepted
   * here: it tells the platform to build a logger of its own, which the
   * application never holds, so an application that asks for one serves no
   * `/logs` rather than a stream that would be empty however loudly it logs.
   */
  readonly logger?: false | LoggerService;
}
