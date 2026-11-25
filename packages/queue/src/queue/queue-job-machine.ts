import { createStateMachine, type StateMachine } from "@aponiajs/compiler";
import type { QueueJobState } from "../interfaces/queue-job.interface.ts";

/**
 * The one lifecycle every job follows.
 *
 * Keeping it as a typestate machine is what makes an invalid transition a
 * `tsc` error in this package and an `INVALID_STATE_TRANSITION` at runtime when
 * a stored job names a state the queue does not know.
 */
export const queueJobDefinition = Object.freeze({
  initial: "pending",
  transitions: {
    pending: { run: "running" },
    running: { complete: "completed", retry: "pending", fail: "failed" },
    failed: { revive: "pending" },
    completed: {},
  },
} as const);

/** A machine at the initial pending state. */
export function queueJobMachine(): StateMachine<"pending", typeof queueJobDefinition> {
  return createStateMachine(queueJobDefinition) as StateMachine<
    "pending",
    typeof queueJobDefinition
  >;
}

/**
 * Validates a persisted state before the queue hydrates a job.
 *
 * @param state - The state the store recorded.
 * @throws An `AponiaError` with `INVALID_STATE_TRANSITION` for an unknown state.
 */
export function validateQueueJobState(state: string): void {
  createStateMachine(queueJobDefinition, { from: state });
}

/** The state a dead letter returns to when revived. */
export function revivedQueueJobState(): QueueJobState {
  return queueJobMachine().transition("run").transition("fail").transition("revive").state;
}
