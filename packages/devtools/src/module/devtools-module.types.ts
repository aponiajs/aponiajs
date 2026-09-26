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
}
