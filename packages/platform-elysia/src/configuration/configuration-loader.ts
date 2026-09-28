import { AponiaError, type ConfigurationOptions, type ConfigurationToken } from "@aponiajs/common";

/**
 * The only code in the framework that reads the environment, and only for a
 * declaration an application asked for.
 *
 * It is not exported from the package: `provideConfiguration` is the boundary,
 * and a loader an application could call directly would be a second way to
 * build a value the graph never sees.
 */
export function loadConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): T {
  const name = configuration.description ?? "configuration";
  const schema = configuration.schema as unknown;

  // Shape first, membership second: `"~standard" in value` throws for
  // `undefined` and for a primitive, and a JavaScript caller has no type checker
  // to stop them. A refusal has to be this framework's code, not the engine's.
  if (typeof schema !== "object" || schema === null || !("~standard" in schema)) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was declared with a value that is not a Standard Schema.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  const validator = (schema as { readonly "~standard": { validate?: unknown } })["~standard"];
  if (typeof validator.validate !== "function") {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was declared with a value that is not a Standard Schema.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  // A copy, so the schema sees a stable input and a later change to the
  // environment cannot reach a value that was already validated.
  const source = { ...(options?.source ?? process.env) };
  const result = (validator.validate as (value: unknown) => unknown)(source);

  // A factory is invoked by `Reflect.apply` inside a synchronous resolve, so
  // nothing here can await. Refusing a promise is what keeps an injected value
  // from being a promise a service then has to await for itself.
  if (typeof (result as { then?: unknown } | null)?.then === "function") {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was validated by a schema that answers asynchronously, which a provider cannot await.`,
      { configuration: name, reason: "asynchronous-validation" },
    );
  }

  const outcome = result as
    | { readonly value: T; readonly issues?: undefined }
    | { readonly issues: readonly unknown[] };

  if ("issues" in outcome && outcome.issues !== undefined) {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      `Configuration "${name}" was refused by its schema with ${outcome.issues.length} issue(s).`,
      { configuration: name, issues: Object.freeze([...outcome.issues]) },
    );
  }

  return (outcome as { readonly value: T }).value;
}
