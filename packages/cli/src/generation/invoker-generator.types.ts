import type { GenerateSchematicResult } from "./schematic.types.ts";

export interface GenerateInvokersOptions {
  /** Directory to resolve the project from. Defaults to the working directory. */
  readonly cwd?: string;
  /** Report what would be written without writing it. */
  readonly dryRun: boolean;
  /** Select a configured project from `aponia.json`. */
  readonly project?: string;
}

export type GenerateInvokersResult = GenerateSchematicResult;
