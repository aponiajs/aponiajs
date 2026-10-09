import type { DeclinedDescriptor } from "./descriptor-emitter.types.ts";
import type { SchematicChange } from "./schematic.types.ts";

/** The `aponia build` options: working directory, project, and dry-run flag. */
export interface GenerateInvokersOptions {
  /** Directory to resolve the project from. Defaults to the working directory. */
  readonly cwd?: string;
  /** Report what would be written without writing it. */
  readonly dryRun: boolean;
  /** Select a configured project from `aponia.json`. */
  readonly project?: string;
}

/** What a build reports: its change lines, dry-run state, and declines. */
export interface GenerateInvokersResult {
  /** The change lines `runCli` prints. */
  readonly changes: readonly SchematicChange[];
  /** `true` when nothing was written. */
  readonly dryRun: boolean;
  /**
   * Every module and route this build could not lower into the generated
   * descriptor module, in the order the emitter met them.
   *
   * It is reported rather than fatal: a decline names a declaration that has to
   * change before the next build can generate it, and until it does the
   * declaration keeps booting through the runtime's own path.
   */
  readonly declined: readonly DeclinedDescriptor[];
}
