/**
 * The graph the container compiled, as the boot recorded it: `"declared"` when
 * the root it served was a `ModuleDefinition` — a build's descriptor, or one a
 * caller passed — and `"decorated"` when it was a class or a dynamic module,
 * both of which the boot lowers.
 *
 * It mirrors the boot record's own union
 * (`AponiaApplicationDiagnostics` in `@aponiajs/platform-elysia`, which is
 * internal to that package) rather than naming it, because this is a wire
 * contract: a payload type may not depend on a type a consumer cannot import.
 */
export type AponiaBuildGraph = "declared" | "decorated";

/**
 * The boot's verdict on the generated invoker artifact.
 *
 * `reason` is the refusal's own sentence and is absent when there is none. A
 * reason belongs to a refusal, so a record that states one only for an artifact
 * it refused is reported the way it is written: an adopted artifact publishes no
 * reason key, and no placeholder stands in for one that was never stated.
 */
export interface AponiaBuildInvokers {
  /** Whether the boot served the application through generated invokers. */
  readonly accepted: boolean;
  /** Why the artifact was refused, absent when there was no refusal. */
  readonly reason?: string | undefined;
}

/**
 * Which binding a build's analysis would supply for one handler: `"generated"`
 * for an invoker the emitter rendered, `"compiled"` for a handler it declined,
 * which stays on the running platform's own compile path.
 */
export type AponiaBuildInvoker = "generated" | "compiled";

/**
 * One handler the analysis decided about.
 *
 * A handler is one property key, however many routes its decorators declare:
 * an invoker answers every route the key serves, so a method carrying two route
 * decorators is one entry with one verdict here.
 *
 * `reason` is the emitter's own words for the handler it declined, and it is
 * absent for one it rendered. The emitter declines what it cannot prove — a
 * handler that takes the whole context through a decorator, whose type the
 * generated source cannot name — and the reason is the answer to "why is this
 * handler not optimized", which is the fact this endpoint exists to publish.
 */
export interface AponiaBuildHandler {
  /** The handler's property key, as the analysis names it. */
  readonly handler: string;
  /** Which binding a build would supply for it. */
  readonly invoker: AponiaBuildInvoker;
  /** Why the emitter declined it, absent for a handler it emitted. */
  readonly reason?: string | undefined;
}

/** One `@Controller()` class the analysis read, with its handlers declared order. */
export interface AponiaBuildController {
  /** The controller's class name. */
  readonly controller: string;
  /** Its handlers in method declaration order, one entry per property key. */
  readonly handlers: readonly AponiaBuildHandler[];
}

/**
 * The payload `/__devtools/aot` answers with: what the boot decided about the
 * generated artifacts, and what a build's emitter decides about the project's
 * controllers.
 *
 * The two halves have different owners and fail differently, which is why they
 * sit beside each other in one payload. `graph` and `invokers` are facts
 * bootstrap already recorded, so they are available the moment the boot is —
 * whether or not a project is on disk, and whether or not the analysis loaded.
 * `controllers` is the analysis, which is imported on the first request to this
 * endpoint and cached for the process, so it can be absent where the boot's own
 * facts are present.
 *
 * `controllers` is empty exactly when no verdicts are available: an analysis
 * that could not be read — no configuration, a project a build would refuse, a
 * dependency that would not load — reports itself once under `Devtools` and
 * leaves this list empty. A project whose controllers were all read answers
 * with them, because a build states a verdict for a project it can read even
 * when it declines to write the module it rendered.
 *
 * What this endpoint states is the *build's* verdict, which is not what served
 * the request: `/routes` reports the binding each mounted route actually
 * reaches, and `invokers.accepted` above is what the boot did with the artifact
 * the build's verdicts would have produced.
 */
export interface AponiaBuildPayload {
  /** Which root the container compiled. */
  readonly graph: AponiaBuildGraph;
  /** The boot's verdict on the generated invoker artifact. */
  readonly invokers: AponiaBuildInvokers;
  /** Every controller the analysis read, sorted by path, with its per-handler verdicts. */
  readonly controllers: readonly AponiaBuildController[];
}
