/** The configuration file the CLI reads. */
export const configurationFileName = "aponia-cli.json";

/** The deprecated configuration file the CLI still accepts for one release. */
export const legacyConfigurationFileName = "aponia.json";

/** The builders `@nestjs/cli` names, kept so a configuration can be read. */
export const availableBuilders = ["tsc", "webpack", "swc", "rspack"] as const;
