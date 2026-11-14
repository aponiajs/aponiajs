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
 * One call site in this package reports a failure, and it is a sentence whose
 * outcome travels beside the report itself: the row an analysis that could not
 * read a project writes, which is paired with the empty controller list `/aot`
 * degrades to. It also runs where a throw would cost more than the row — a
 * promise every later poll of `/aot` is answered from — so a logger that refuses
 * a row may not take the answer with it.
 *
 * A refusal is answered rather than swallowed: the sentence is written straight
 * to `stderr` — the only place this package writes a process stream — because the
 * channel that would normally carry the row is the one that just failed. That
 * line states the refusal alongside the sentence, so a reader knows why a report
 * the logger was configured to carry arrived here instead, and it states the
 * refusal as a sentence of its own: the report it follows ends in a period
 * already, so a clause appended inside it would land mid-line. The write is
 * guarded in turn, because a process may be writing to a stream that refuses:
 * the absence is accepted at the last line rather than taken out on the caller.
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
    process.stderr.write(`${sentence} The configured logger threw while reporting it.\n`);
  } catch {
    // Nothing left to report to.
  }
}
