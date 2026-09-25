import type { ClassToken, LoggerService } from "@aponiajs/common";
import type { AponiaInvokerArtifact } from "./invoker-artifact.types.ts";
import type { AponiaControllerInvokerFactory } from "./route-compiler.types.ts";

/**
 * The invokers this artifact may contribute, or `undefined` when the platform
 * has to compile them itself.
 *
 * A generated artifact is only interchangeable with the platform's own
 * compilation within the framework release that produced it: the invoker shape
 * is emitted against that release's route compilation and its supported Elysia
 * range. Bootstrap therefore checks the artifact once, before any controller
 * mounts, and every controller falls back to compiled binding when it is
 * refused.
 *
 * A refusal is not an error. The fallback is the compilation the platform would
 * have done without the option, so refusing costs a cold start rather than a
 * request, and an artifact can never turn a bootable application into a failing
 * one. The log line is the only report, and it names both versions so a stale
 * file is diagnosable from the startup output.
 */
export function selectInvokerArtifact(
  artifact: AponiaInvokerArtifact | undefined,
  frameworkVersion: string,
  logger: LoggerService | undefined,
): ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory> | undefined {
  if (artifact === undefined) {
    return undefined;
  }

  // A hand-written or truncated artifact is refused the same way a stale one
  // is. The option is typed, but a JavaScript caller has no type checker.
  if (!(artifact.invokers instanceof Map)) {
    logger?.log(
      "The generated invoker artifact carries no invoker map, so routes are compiled from decorator metadata.",
      "RoutesResolver",
    );
    return undefined;
  }

  if (artifact.framework !== frameworkVersion) {
    logger?.log(
      `The generated invoker artifact was built by AponiaJS ${artifact.framework} against ` +
        `Elysia ${artifact.elysia ?? "an unresolved version"}, but AponiaJS ${frameworkVersion} ` +
        "is running, so routes are compiled from decorator metadata. Run `aponia build` again.",
      "RoutesResolver",
    );
    return undefined;
  }

  return artifact.invokers;
}
