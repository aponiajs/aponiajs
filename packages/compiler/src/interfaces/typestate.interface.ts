/** A transition table: each state names the events it accepts and their target. */
export interface StateMachineDefinition {
  /** The state a fresh machine starts in. */
  readonly initial: string;
  /** One entry per declared state. */
  readonly transitions: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Every state a definition declares. */
export type StateName<TDefinition extends StateMachineDefinition> =
  keyof TDefinition["transitions"] & string;

/** Every event one state accepts, distributed over a union of states. */
export type EventName<
  TDefinition extends StateMachineDefinition,
  TState extends StateName<TDefinition>,
> =
  TState extends StateName<TDefinition> ? keyof TDefinition["transitions"][TState] & string : never;

/** The state an event reaches from one state, distributed over a union of states. */
export type NextState<
  TDefinition extends StateMachineDefinition,
  TState extends StateName<TDefinition>,
  TEvent extends EventName<TDefinition, TState>,
> =
  TState extends StateName<TDefinition>
    ? TEvent extends keyof TDefinition["transitions"][TState]
      ? TDefinition["transitions"][TState][TEvent] & string
      : never
    : never;

/** Options a fresh machine accepts. */
export interface StateMachineOptions {
  /** Hydrates the machine at a persisted state the definition declares. */
  readonly from?: string;
}

/**
 * An immutable typestate machine.
 *
 * `transition()` returns a new machine typed at the target state, so an event
 * that state does not accept is a `tsc` error. The definition is validated when
 * the machine is created: an undeclared initial or hydrated state, and a target
 * no state declares, throw `INVALID_STATE_TRANSITION`.
 */
export interface StateMachine<TState extends string, TDefinition extends StateMachineDefinition> {
  /** The state this machine is in. */
  readonly state: TState;
  /** Transitions to the event's target and returns a new machine. */
  transition<TEvent extends EventName<TDefinition, TState>>(
    event: TEvent,
  ): StateMachine<NextState<TDefinition, TState, TEvent> & StateName<TDefinition>, TDefinition>;
  /** Whether this state accepts the event. */
  can(event: string): boolean;
  /** The events this state accepts, frozen. */
  allowedEvents(): readonly string[];
}
