# @aponiajs/config — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Nest-compatible application configuration for AponiaJS: `ConfigModule.forRoot`,
`ConfigModule.forRootAsync`, `ConfigModule.forFeature`, `ConfigService`,
`registerAs`, `.env` file loading, `${VAR}` expansion, and schema validation.

| Domain        | Owns                                                              |
| ------------- | ----------------------------------------------------------------- |
| `interfaces/` | `ConfigModuleOptions`, `ConfigModuleAsyncOptions`, `ConfigObject` |
| `utils/`      | `.env` parsing, variable expansion, `registerAs` namespace tokens |
| `root`        | `ConfigModule`, `ConfigService`, `config.constants.ts`            |

`src/index.ts` is the only public barrel.
