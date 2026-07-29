import type { generateSchematics } from "./command.constants.ts";

export interface NewCommandOptions {
  readonly command: "new";
  readonly name: string;
  readonly dryRun: boolean;
  readonly skipInstall: boolean;
}

export type GenerateSchematic = (typeof generateSchematics)[number];

export type ResourceTransport =
  | "rest"
  | "graphql-code-first"
  | "graphql-schema-first"
  | "microservice"
  | "ws";

export interface GenerateCommandOptions {
  readonly command: "generate";
  readonly schematic: GenerateSchematic;
  readonly name: string;
  readonly dryRun: boolean;
  readonly flat?: boolean;
  readonly spec?: boolean;
  readonly skipImport: boolean;
  readonly path?: string;
  readonly module?: string;
  readonly project?: string;
  readonly crud: boolean;
  readonly type: ResourceTransport;
}

export type CliCommand =
  | NewCommandOptions
  | GenerateCommandOptions
  | { readonly command: "help" }
  | { readonly command: "version" };
