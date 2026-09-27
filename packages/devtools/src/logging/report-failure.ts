import type { LoggerService } from "@aponiajs/common";

/**
 * States one failure report through the logger, and on `stderr` when the logger
 * refuses it.
 *
 * `LoggerService` is a public interface an application implements, so a method
 * may throw and no caller may read a successful call as a promise the interface
 * makes. The rule this holds to is the framework's, and it is narrow on purpose:
 * a call site that reports a failure guards, and a call site that reports
 * progress does not.
 *
 * Two call sites in this package report a failure, and both are sentences whose
 * outcome travels beside the report itself: the row a refused bind writes, which
 * is paired with the `undefined` that says there is nothing to report as
 * listening, and the row an analysis that could not read a project writes, which
 * is paired with the empty controller list `/aot` degrades to. Both also run
 * where a throw would cost more than the row — the plugin's `onStart`, which
 * Elysia neither awaits nor catches, and a promise every later poll of `/aot` is
 * answered from — so a logger that refuses a row may not take the answer with it.
 *
 * A refusal is answered rather than swallowed: the sentence is written straight
 * to `stderr` — the only place this package writes a process stream — because the
 * channel that would normally carry the row is the one that just failed. That
 * line names the refusal as well as the sentence, so a reader knows why a report
 * the logger was configured to carry arrived here instead. The write is guarded
 * in turn, because a process may be writing to a stream that refuses: the absence
 * is accepted at the last line rather than taken out on the caller.
 *
 * What the logger threw is not rendered: this states that the logger refused,
 * not what it refused with. `ConsoleLogger` — the one this framework builds —
 * never refuses, so this path answers for a logger an application supplied.
 */
export function reportFailure(logger: LoggerService, sentence: string): void {
  try {
    logger.warn(sentence);
  } catch {
    announceRefusedReport(sentence);
  }
}

/**
 * States a report where a reader will see it, when the logger would not.
 *
 * Guarded for the reason the call above is: a throw out of this one would leave
 * the caller with no report and no answer, which are the two things the guarded
 * call sites exist to deliver together. A `stderr` write that refuses leaves
 * nothing further to report to.
 */
function announceRefusedReport(sentence: string): void {
  try {
    process.stderr.write(`${sentence} (the configured logger threw while reporting it)\n`);
  } catch {
    // Nothing left to report to.
  }
}
