/** The `aponia new` options: a project name and its creation flags. */
export interface GenerateProjectOptions {
  /** The project directory and package name to generate. */
  readonly name: string;
  /** The working directory the project is created under. */
  readonly cwd?: string;
  /** Plan without writing. */
  readonly dryRun?: boolean;
  /** Skip dependency installation after generation. */
  readonly skipInstall?: boolean;
  /** Generate a workspace with `apps/api` and `libs/`. */
  readonly workspace?: boolean;
  /** The HTTP platform the application boots on. */
  readonly platform?: "elysia" | "hono" | "h3";
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
