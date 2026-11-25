import { AponiaError } from "@aponiajs/common";
import type {
  EventName,
  NextState,
  StateMachine,
  StateMachineDefinition,
  StateMachineOptions,
  StateName,
} from "../interfaces/typestate.interface.ts";

/**
 * Creates an immutable typestate machine from a literal transition table.
 *
 * The `const` type parameter keeps state, event, and target names literal, so
 * the chain is checked by `tsc`. A machine never mutates: `transition()` returns
 * a new machine at the target state.
 *
 * @param definition - The initial state and every declared transition.
 * @returns A machine at the initial or hydrated state.
 * @throws An `AponiaError` with `INVALID_STATE_TRANSITION` when the definition
 * or the hydrated state is invalid.
 *
 * @example
 * ```ts
 * const draft = createStateMachine({
 *   initial: "draft",
 *   transitions: {
 *     draft: { publish: "published" },
 *     published: { archive: "archived" },
 *     archived: {},
 *   },
 * });
 *
 * const published = draft.transition("publish");
 * published.transition("archive");
 * ```
 */
export function createStateMachine<const TDefinition extends StateMachineDefinition>(
  definition: TDefinition,
): StateMachine<TDefinition["initial"] & StateName<TDefinition>, TDefinition>;
export function createStateMachine<const TDefinition extends StateMachineDefinition>(
  definition: TDefinition,
  options: StateMachineOptions & { readonly from: string },
): StateMachine<StateName<TDefinition>, TDefinition>;
export function createStateMachine<const TDefinition extends StateMachineDefinition>(
  definition: TDefinition,
  options: StateMachineOptions = {},
): StateMachine<StateName<TDefinition>, TDefinition> {
  const transitions = new Map<string, ReadonlyMap<string, string>>();
  for (const [state, events] of Object.entries(definition.transitions)) {
    transitions.set(state, new Map(Object.entries(events)));
  }
  if (transitions.size === 0) {
    throw unknownState(definition.initial, []);
  }

  const states = Object.freeze([...transitions.keys()]);
  const initial = options.from ?? definition.initial;
  if (!transitions.has(initial)) {
    throw unknownState(initial, states);
  }

  for (const [state, events] of transitions) {
    for (const [event, target] of events) {
      if (!transitions.has(target)) {
        throw new AponiaError(
          "INVALID_STATE_TRANSITION",
          `The transition "${state}" --${event}--> "${target}" names a state the definition does not declare.`,
          {
            from: state,
            event,
            target,
            allowed: states,
            reason: "unknown-target",
          },
        );
      }
    }
  }

  const machine = new StateMachineImpl(initial, transitions) as unknown as StateMachine<
    StateName<TDefinition>,
    TDefinition
  >;
  return machine;
}

function unknownState(state: string, allowed: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_STATE_TRANSITION",
    `The state "${state}" is not declared by this machine.`,
    {
      from: state,
      allowed,
      reason: "unknown-state",
    },
  );
}

class StateMachineImpl<TDefinition extends StateMachineDefinition> {
  readonly #state: StateName<TDefinition>;
  readonly #transitions: ReadonlyMap<string, ReadonlyMap<string, string>>;

  constructor(state: string, transitions: ReadonlyMap<string, ReadonlyMap<string, string>>) {
    this.#state = state as StateName<TDefinition>;
    this.#transitions = transitions;
  }

  get state(): StateName<TDefinition> {
    return this.#state;
  }

  transition<TState extends StateName<TDefinition>, TEvent extends EventName<TDefinition, TState>>(
    this: StateMachineImpl<TDefinition> & { readonly state: TState },
    event: TEvent,
  ): StateMachineImpl<TDefinition> {
    return this.#transition(event);
  }

  can(event: string): boolean {
    return this.#transitions.get(this.#state)?.has(event) ?? false;
  }

  allowedEvents(): readonly string[] {
    return Object.freeze([...(this.#transitions.get(this.#state)?.keys() ?? [])]);
  }

  #transition(event: string): StateMachineImpl<TDefinition> {
    const events = this.#transitions.get(this.#state);
    const target = events?.get(event);
    if (events === undefined || target === undefined) {
      throw new AponiaError(
        "INVALID_STATE_TRANSITION",
        `The state "${this.#state}" does not accept the event "${event}".`,
        {
          from: this.#state,
          event,
          allowed: Object.freeze([...(events?.keys() ?? [])]),
          reason: "unknown-event",
        },
      );
    }
    return new StateMachineImpl<TDefinition>(target, this.#transitions);
  }
}

export type {
  EventName,
  NextState,
  StateMachine,
  StateMachineDefinition,
  StateMachineOptions,
  StateName,
};
