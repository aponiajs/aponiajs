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
   * The logger whose lines `/__devtools/logs` records: pass the same value the
   * application gives `AponiaFactory.create`.
   *
   * The logger is the application's, and the framework holds the one object it
   * was given, so this is how the lines a boot and a running application write
   * reach the stream. The object is patched in place and never replaced: every
   * line it already printed is still printed, in the same order, through the same
   * object the application holds.
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
   * application never holds, so there would be no object to record from.
   */
  readonly logger?: false | LoggerService;
}
