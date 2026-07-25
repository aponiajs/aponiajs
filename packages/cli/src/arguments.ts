export interface NewCommandOptions {
  readonly command: "new";
  readonly name: string;
  readonly dryRun: boolean;
  readonly skipInstall: boolean;
}

export type CliCommand =
  | NewCommandOptions
  | { readonly command: "help" }
  | { readonly command: "version" };

export function parseArguments(arguments_: readonly string[]): CliCommand {
  const [command = "help", ...rest] = arguments_;

  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    return { command: "version" };
  }

  if (command !== "new" && command !== "n") {
    throw new Error(`Unknown command "${command}".`);
  }

  const name = rest.find((argument) => !argument.startsWith("-"));
  if (!name) {
    throw new Error("Project name is required.");
  }

  const supportedOptions = new Set(["--dry-run", "-d", "--skip-install", "-s"]);
  const unknownOption = rest.find(
    (argument) => argument.startsWith("-") && !supportedOptions.has(argument),
  );
  if (unknownOption) {
    throw new Error(`Unknown option "${unknownOption}".`);
  }

  return {
    command: "new",
    name,
    dryRun: rest.includes("--dry-run") || rest.includes("-d"),
    skipInstall: rest.includes("--skip-install") || rest.includes("-s"),
  };
}
