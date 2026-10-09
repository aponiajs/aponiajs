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
