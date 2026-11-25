/** The `aponia new` options: a project name and its creation flags. */
export interface GenerateProjectOptions {
  /** The project directory and package name to generate. */
  readonly name: string;
  /** The working directory the project is created under. */
  readonly cwd?: string;
  /** The destination directory; defaults to the project name. */
  readonly directory?: string;
  /** Plan without writing. */
  readonly dryRun?: boolean;
  /** Skip dependency installation after generation. */
  readonly skipInstall?: boolean;
  /** Generate a Bun-first project; the default. */
  readonly type?: "bun" | "esm" | "cjs";
  /** The test runner the generated scripts name. */
  readonly testRunner?: "bun" | "vitest" | "jest";
  /** Generate the single-file starter. */
  readonly minimal?: boolean;
  /** The package manager the install runs under. */
  readonly packageManager?: string;
  /** The source language; `ts` is the only supported value. */
  readonly language?: string;
  /** Enable TypeScript strict mode; defaults to true. */
  readonly strict?: boolean;
  /** The schematic collection the generated configuration names. */
  readonly collection?: string;
  /** Preconfigure the observability surface; omitted keeps the starter default. */
  readonly observe?: boolean;
  /** The coding-agent clients whose skills are installed. */
  readonly skills?: readonly ("codex" | "claude" | "cursor")[];
  /** Skip installing coding-agent skills. */
  readonly skipSkills?: boolean;
  /** Skip initializing a Git repository. */
  readonly skipGit?: boolean;
}

/** What a project run reports: its directory, files, and install state. */
export interface GenerateProjectResult {
  /** The created project directory. */
  readonly projectDirectory: string;
  /** The project-relative files written or planned. */
  readonly files: readonly string[];
  /** Whether dependencies were installed. */
  readonly installed: boolean;
  /** `true` when nothing was written. */
  readonly dryRun: boolean;
}
