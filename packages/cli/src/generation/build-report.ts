import type { DeclinedDescriptor } from "./descriptor-emitter.types.ts";
import type { GenerateInvokersResult } from "./invoker-generator.types.ts";

/**
 * The lines one build reports: a change line per file it wrote, then a decline
 * line per declaration it could not lower.
 *
 * `aponia build` prints these and the bundler plugin prints the same lines, so
 * the two ways of running generation cannot drift apart in what they say. The
 * declines come last because a change is what the build did and a decline is
 * what it could not do.
 */
export function formatBuildReport(result: GenerateInvokersResult): readonly string[] {
  return [
    ...result.changes.map((change) => `${change.kind} ${change.path}`),
    ...result.declined.map(describeDecline),
  ];
}

/**
 * One line per declaration a build could not lower.
 *
 * A decline is not a change line, so it reads differently on purpose: the build
 * succeeded, and what it names is the source that has to change before the next
 * one can generate it.
 */
function describeDecline(decline: DeclinedDescriptor): string {
  return decline.kind === "module"
    ? `DECLINED module ${decline.module}: ${decline.reason}`
    : `DECLINED route ${decline.module}.${decline.controller}.${decline.method}: ${decline.reason}`;
}
