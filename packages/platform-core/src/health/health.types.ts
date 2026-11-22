/**
 * The paths an orchestrator can poll.
 *
 * Both default, so `health: true` is the whole opt-in for the conventional pair.
 * A path is the only thing this contract states: there is deliberately no option
 * for what a probe answers, because the answer is the field an orchestrator
 * reads and a configurable one would let an application report readiness it does
 * not have.
 */
export interface AponiaHealthOptions {
  /**
   * The path liveness answers on, which is `GET /health/live` by default.
   *
   * It answers `200` for as long as the process can answer at all, which is the
   * whole question a liveness probe asks: a process that should be restarted
   * fails to answer, and this platform does not try to tell a hung process from
   * a dead one on the application's behalf.
   */
  readonly livenessPath?: string;
  /**
   * The path readiness answers on, which is `GET /health/ready` by default.
   *
   * It answers `200` until this application begins to stop and `503` from then
   * on, so an orchestrator reads the drained half of a shutdown from it. It is
   * the pairing of the two probes that makes a stop graceful rather than a
   * dropped connection.
   */
  readonly readinessPath?: string;
}

/**
 * The verdict an IETF health-check document carries.
 *
 * `pass` and `fail` are two of the three states the draft defines; `warn` is
 * absent because a probe this platform answers has nothing to warn about — the
 * application is either serving or it is not.
 */
export type AponiaHealthStatus = "pass" | "fail";

/**
 * The document a probe answers with, as `application/health+json` defines it.
 *
 * Only the required member is sent. The draft's optional members describe an
 * application — the release, the output of its own dependency checks — and this
 * platform states what it can answer for every application rather than a shape
 * an application has to fill in. An application that needs a deeper check
 * declares a route of its own and a probe pointed at it by path.
 */
export interface AponiaHealthResponse {
  readonly status: AponiaHealthStatus;
}
