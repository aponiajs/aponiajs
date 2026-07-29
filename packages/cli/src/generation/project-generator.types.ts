export interface GenerateProjectOptions {
  readonly name: string;
  readonly cwd?: string;
  readonly dryRun?: boolean;
  readonly skipInstall?: boolean;
}

export interface GenerateProjectResult {
  readonly projectDirectory: string;
  readonly files: readonly string[];
  readonly installed: boolean;
  readonly dryRun: boolean;
}
