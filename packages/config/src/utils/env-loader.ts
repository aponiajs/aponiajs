import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AponiaError, isStandardSchema, isValidatorSchema } from "@aponiajs/common";
import type { ConfigObject, ConfigModuleOptions } from "../interfaces/config-module.interface.ts";

/**
 * Parses `.env` text into key-value pairs, stripping comments and surrounding quotes.
 *
 * @param content - Raw `.env` file text.
 * @returns Parsed key-value record.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Expands `${VAR}` and `${VAR:-default}` placeholders against `env`.
 *
 * @param raw - Input record before expansion.
 * @param baseEnv - Existing environment variables available during expansion.
 * @returns New record with expanded string values.
 */
export function expandEnvVariables(
  raw: Record<string, string>,
  baseEnv: Record<string, string | undefined>,
): Record<string, string> {
  const combined: Record<string, string | undefined> = { ...baseEnv, ...raw };
  const expanded: Record<string, string> = {};
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

  for (const [key, value] of Object.entries(raw)) {
    const resolved = value.replace(
      pattern,
      (_match, varName: string, fallback: string | undefined) => {
        const candidate = expanded[varName] ?? combined[varName];
        if (candidate !== undefined && candidate !== "") {
          return candidate;
        }
        return fallback ?? "";
      },
    );
    expanded[key] = resolved;
    combined[key] = resolved;
  }
  return expanded;
}

/**
 * Loads `.env` files, applies `process.env`, and validates against `validate` or `validationSchema`.
 *
 * @param options - `ConfigModuleOptions` controlling loading and validation.
 * @returns Validated configuration object.
 */
export async function loadEnvironmentConfig(options: ConfigModuleOptions): Promise<ConfigObject> {
  let fileEnv: Record<string, string> = {};

  if (options.ignoreEnvFile !== true) {
    const paths =
      options.envFilePath === undefined
        ? [resolve(process.cwd(), ".env")]
        : Array.isArray(options.envFilePath)
          ? options.envFilePath
          : [options.envFilePath as string];

    for (const filePath of paths) {
      if (!existsSync(filePath)) {
        continue;
      }
      const content = readFileSync(filePath, options.encoding ?? "utf8");
      fileEnv = { ...fileEnv, ...parseEnvContent(content) };
    }
  }

  const baseEnv = options.ignoreEnvVars === true ? {} : { ...process.env };

  if (options.expandVariables === true) {
    fileEnv = expandEnvVariables(fileEnv, baseEnv);
  }

  if (options.skipProcessEnv !== true) {
    for (const [key, value] of Object.entries(fileEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  let merged: ConfigObject = { ...fileEnv, ...baseEnv };

  if (options.validate !== undefined) {
    merged = options.validate(merged);
  }

  if (options.validationSchema !== undefined) {
    merged = await validateWithSchema(options.validationSchema, merged);
  }

  return merged;
}

async function validateWithSchema(schema: unknown, value: ConfigObject): Promise<ConfigObject> {
  if (isStandardSchema(schema)) {
    const result = await schema["~standard"].validate(value);
    if ("issues" in result && result.issues !== undefined) {
      throw new AponiaError(
        "INVALID_CONFIGURATION_VALUE",
        "Environment configuration validation failed.",
        {
          configuration: "ConfigModule",
          issues: result.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        },
      );
    }
    return (result as { readonly value: ConfigObject }).value;
  }

  if (isValidatorSchema(schema)) {
    const { Value } = await import("typebox/value");
    if (!Value.Check(schema as never, value)) {
      const errors = [...Value.Errors(schema as never, value)];
      throw new AponiaError(
        "INVALID_CONFIGURATION_VALUE",
        "Environment configuration validation failed.",
        {
          configuration: "ConfigModule",
          issues: errors.map((err) => ({ message: err.message, path: err.instancePath })),
        },
      );
    }
    return Value.Parse(schema as never, value) as ConfigObject;
  }

  throw new AponiaError(
    "INVALID_CONFIGURATION",
    "ConfigModule validationSchema must be a Standard Schema or TypeBox ValidatorSchema.",
    { option: "validationSchema" },
  );
}
