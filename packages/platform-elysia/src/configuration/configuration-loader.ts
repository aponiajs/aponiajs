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
  // The fallback is for a token a JavaScript caller built by hand:
  // `defineConfiguration` always supplies a description.
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

  const validator = (schema as { readonly "~standard"?: unknown })["~standard"];
  if (
    typeof validator !== "object" ||
    validator === null ||
    typeof (validator as { validate?: unknown }).validate !== "function"
  ) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was declared with a value that is not a Standard Schema.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  // A copy, so the schema sees a stable input and a later change to the
  // environment cannot reach a value that was already validated.
  const source = { ...(options?.source ?? process.env) };
  // The cast is the price of the guard above: `validator` is only known to be an
  // object there, because the check on `validate` cannot narrow it.
  const result = (validator as { readonly validate: (value: unknown) => unknown }).validate(source);

  // A factory is invoked by `Reflect.apply` inside a synchronous resolve, so
  // nothing here can await. Refusing a promise is what keeps an injected value
  // from being a promise a service then has to await for itself.
  if (typeof (result as { then?: unknown } | null)?.then === "function") {
    // Observed rather than abandoned: refusing the value does not make a rejected
    // promise handled, and an unhandled rejection outlives the refusal.
    // `Promise.resolve` rather than `.catch` on the result: the guard accepts any
    // thenable, and a thenable that is not a promise has no `.catch` at all.
    void Promise.resolve(result).catch(() => undefined);

    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was validated by a schema that answers asynchronously, which a provider cannot await.`,
      { configuration: name, reason: "asynchronous-validation" },
    );
  }

  const outcome = result as unknown;

  // The same rule one line later: a validator that answers with null, a primitive,
  // or neither shape is not behaving as a Standard Schema either, and reading a
  // field off it would be the engine's error rather than this framework's refusal.
  if (typeof outcome !== "object" || outcome === null) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was validated by a schema that answered with ${outcome === null ? "null" : typeof outcome} instead of a result.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  // Present-but-undefined `issues` is the same violation: the protocol answers
  // with one of the two, and a key carrying nothing injects `undefined`.
  if (!("value" in outcome) && (outcome as { issues?: unknown }).issues === undefined) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was validated by a schema that answered with neither a value nor issues.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  if ("issues" in outcome && outcome.issues !== undefined) {
    const issues = outcome.issues as readonly unknown[];

    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      `Configuration "${name}" was refused by its schema with ${issues.length} issue(s).`,
      { configuration: name, issues: Object.freeze([...issues]) },
    );
  }

  return (outcome as { readonly value: T }).value;
}
