import type { LoggerService } from "@aponiajs/common";
import type { AponiaInvokerArtifact, AponiaInvokerSelection } from "./invoker-artifact.types.ts";

/**
 * The invokers this artifact may contribute, and the reason when it may not.
 *
 * A generated artifact is only interchangeable with the platform's own
 * compilation within the framework release that produced it: the invoker shape
 * is emitted against that release's route compilation and its supported Elysia
 * range. Bootstrap therefore asks for the decision once, before any controller
 * mounts, and every controller falls back to compiled binding when the artifact
 * is refused.
 *
 * A refusal is not an error. The fallback is the compilation the platform would
 * have done without the option, so refusing costs a cold start rather than a
 * request, and an artifact can never turn a bootable application into a failing
 * one. The decision travels back to the caller as data — the boot publishes it
 * in the record it attaches to the application — and the refused cases also
 * report the same sentence on the boot's log channel.
 *
 * The decision carries the artifact's own release stamp beside the reason, so a
 * consumer reports which release supplied the invokers without holding the
 * artifact. Only adoption has one: a refused artifact was built by some other
 * release by definition, and reporting that number would name the provenance of
 * binding this boot did not use.
 *
 * @param artifact - The generated artifact the application passed, if any.
 * @param frameworkVersion - The running release the stamp is compared against.
 * @param logger - The system logger the refusal is reported through.
 * @returns The adopted invokers, or the reason for their absence.
 *
 * @internal
 */
export function selectInvokerArtifact(
  artifact: AponiaInvokerArtifact | undefined,
  frameworkVersion: string,
  logger: LoggerService | undefined,
): AponiaInvokerSelection {
  if (artifact === undefined) {
    return Object.freeze({
      invokers: undefined,
      reason: "No generated invoker artifact was supplied.",
      builtBy: null,
    });
  }

  // A hand-written or truncated artifact is refused the same way a stale one
  // is. The option is typed, but a JavaScript caller has no type checker.
  if (!(artifact.invokers instanceof Map)) {
    return refuse("The generated invoker artifact carries no invoker map.", logger);
  }

  if (artifact.framework !== frameworkVersion) {
    return refuse(
      `The generated invoker artifact was built by AponiaJS ${artifact.framework} against ` +
        `Elysia ${artifact.elysia ?? "an unresolved version"}, but AponiaJS ${frameworkVersion} is running.`,
      logger,
    );
  }

  return Object.freeze({
    invokers: artifact.invokers,
    reason: undefined,
    builtBy: artifact.framework,
  });
}

/**
 * Reports a refusal on the boot's own channel and returns it as the decision.
 *
 * The recorded reason and the log line are one sentence: the reason is what a
 * reader of the record sees, and the line adds what the boot did about it, so a
 * stale file stays diagnosable from the startup output alone.
 */
function refuse(reason: string, logger: LoggerService | undefined): AponiaInvokerSelection {
  logger?.log(
    `${reason} Routes are compiled from decorator metadata. Run \`aponia build\` again.`,
    "RoutesResolver",
  );

  return Object.freeze({ invokers: undefined, reason, builtBy: null });
}
