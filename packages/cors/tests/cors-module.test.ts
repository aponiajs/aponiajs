import { expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Module,
  defineConfiguration,
  type AponiaErrorCode,
} from "@aponiajs/common";
import {
  AponiaFactory,
  PluginModule,
  inspectAponiaApplication,
  type AponiaApplication,
} from "@aponiajs/platform-elysia";
import { cors } from "@elysia/cors";
import { z } from "zod";
import { CorsModule } from "../src/index.ts";
import type { CorsConfiguration } from "../src/index.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

/**
 * The policy declaration of the shape an environment supplies: one variable per
 * field, with the defaults that make `source: {}` a complete declaration.
 *
 * Every case names its configuration, so a refusal names the declaration the
 * case wrote rather than an anonymous one. The values are what an environment
 * can actually carry — strings, a boolean, and a number — which is the whole
 * contract this package adds over the raw plugin.
 */
function policyOf(name: string) {
  return defineConfiguration(
    z
      .object({
        CORS_ORIGINS: z.string().min(1).default("https://app.example"),
        CORS_ALLOWED_HEADERS: z.string().min(1).default("content-type"),
        CORS_EXPOSE_HEADERS: z.string().min(1).default("x-request-id"),
        CORS_CREDENTIALS: z.enum(["true", "false"]).default("false"),
        CORS_MAX_AGE: z.coerce.number().int().nonnegative().default(5),
      })
      .transform(
        ({
          CORS_ORIGINS,
          CORS_ALLOWED_HEADERS,
          CORS_EXPOSE_HEADERS,
          CORS_CREDENTIALS,
          CORS_MAX_AGE,
        }) =>
          ({
            origins: CORS_ORIGINS.split(",").map((origin) => origin.trim()),
            allowedHeaders: CORS_ALLOWED_HEADERS.split(",").map((header) => header.trim()),
            exposeHeaders: CORS_EXPOSE_HEADERS.split(",").map((header) => header.trim()),
            credentials: CORS_CREDENTIALS === "true",
            maxAge: CORS_MAX_AGE,
          }) satisfies CorsConfiguration,
      ),
    `cors.${name}`,
  );
}

/** The same declaration with no defaults, so an empty source is what a schema refuses. */
function requiredPolicyOf(name: string) {
  return defineConfiguration(
    z
      .object({ CORS_ORIGINS: z.string().min(1) })
      .transform(({ CORS_ORIGINS }) => ({ origins: [CORS_ORIGINS] }) satisfies CorsConfiguration),
    `cors.${name}`,
  );
}

/** The cross-origin headers one response carried, so an assertion names only what it is about. */
function corsHeaders(response: Response): Record<string, string> {
  const observed: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    if (key.startsWith("access-control") || key === "vary") {
      observed[key] = value;
    }
  });

  return observed;
}

@Controller("ping")
class PingController {
  @Get("/")
  ping(): string {
    return "pong";
  }
}

test("answers the origins the validated configuration declared, and refuses the rest", async (): Promise<void> => {
  const CorsConfig = policyOf("allowed");

  @Module({
    imports: [CorsModule.register({ configuration: CorsConfig, source: {} })],
    controllers: [PingController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const allowed = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://app.example" } }),
    );

    expect(allowed.status).toBe(200);
    expect(corsHeaders(allowed)).toMatchObject({
      "access-control-allow-origin": "https://app.example",
      vary: "Origin",
    });

    // The one default this adapter changes rather than inherits. The wrapped
    // plugin defaults `credentials` to `true`; this one defaults it to `false`,
    // so a policy that never asked for credentialed requests does not state
    // `Access-Control-Allow-Credentials` at all.
    expect(corsHeaders(allowed)["access-control-allow-credentials"]).toBeUndefined();

    const denied = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://evil.example" } }),
    );

    expect(denied.status).toBe(200);
    expect(corsHeaders(denied)["access-control-allow-origin"]).toBeUndefined();
    // `vary: Origin` on a denial is the point: a cache must not answer a later
    // allowed origin from the denied response.
    expect(corsHeaders(denied).vary).toBe("Origin");

    const anonymous = await application.handle(new Request("http://localhost/ping"));

    expect(corsHeaders(anonymous)["access-control-allow-origin"]).toBeUndefined();

    // The module provides the configuration it consumes and exports it, so the
    // application reads back the same validated value the policy was built from.
    expect(application.get(CorsConfig).origins).toEqual(["https://app.example"]);
  } finally {
    await application.close();
  }
});

test("states credentials only when the application declared them", async (): Promise<void> => {
  const CorsConfig = policyOf("credentials");

  @Module({
    imports: [
      CorsModule.register({
        configuration: CorsConfig,
        source: { CORS_CREDENTIALS: "true" },
      }),
    ],
    controllers: [PingController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://app.example" } }),
    );

    expect(corsHeaders(response)).toMatchObject({
      "access-control-allow-origin": "https://app.example",
      "access-control-allow-credentials": "true",
    });
  } finally {
    await application.close();
  }
});

test("answers a preflight without reaching a route", async (): Promise<void> => {
  const CorsConfig = policyOf("preflight");

  @Module({
    imports: [CorsModule.register({ configuration: CorsConfig, source: {} })],
    controllers: [PingController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // `OPTIONS /ping` is not a route any controller declared: the two `OPTIONS`
    // routes the plugin mounts are what answer it, which is what the status and
    // the `allow-methods` echoing the requested method prove.
    const preflight = await application.handle(
      new Request("http://localhost/ping", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );

    expect(preflight.status).toBe(204);
    expect(corsHeaders(preflight)).toMatchObject({
      "access-control-allow-origin": "https://app.example",
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "5",
      vary: "Origin",
    });

    // The preflight for a denied origin is answered too, and answered without an
    // allowed origin, so the browser blocks the request it was asking about.
    const denied = await application.handle(
      new Request("http://localhost/ping", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
      }),
    );

    expect(denied.status).toBe(204);
    expect(corsHeaders(denied)["access-control-allow-origin"]).toBeUndefined();
  } finally {
    await application.close();
  }
});

test("answers a request no route matched, because the policy is a hook over the application", async (): Promise<void> => {
  const CorsConfig = policyOf("noroute");

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/nothing-here", { headers: { Origin: "https://app.example" } }),
    );

    // The wrapped plugin answers from a `request` hook, which runs before
    // routing, so a 404 carries the policy too. An application that served an
    // error response without the headers would leave a browser reporting a CORS
    // failure instead of the status the server actually sent.
    expect(response.status).toBe(404);
    expect(corsHeaders(response)["access-control-allow-origin"]).toBe("https://app.example");
  } finally {
    await application.close();
  }
});

test("refuses a boot whose configuration the schema rejects", async (): Promise<void> => {
  const CorsConfig = requiredPolicyOf("required");

  @Module({
    imports: [
      CorsModule.register({
        configuration: CorsConfig,
        // `CORS_ORIGINS` has no default, so the source is what the schema refuses.
        source: {},
      }),
    ],
  })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "cors.required" });
  expect((failure as AponiaError).details.issues).toHaveLength(1);
});

test("refuses a policy only a runtime could produce, naming every field at once", async (): Promise<void> => {
  const CorsConfig = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          origins: [],
          methods: [""],
          allowedHeaders: 42,
          exposeHeaders: [],
          credentials: "true",
          maxAge: -1,
          preflight: "yes",
        }) as unknown as CorsConfiguration,
    ),
    "cors.malformed",
  );

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "cors.malformed" });

  // Every field that fails, not just the first: a boot that names one problem at
  // a time is a boot a maintainer runs seven times.
  expect((failure as AponiaError).details.issues).toEqual([
    '"origins" must be a non-empty array of non-empty origin strings',
    '"methods" must be a non-empty array of non-empty method strings',
    '"allowedHeaders" must be a non-empty array of non-empty header names',
    '"exposeHeaders" must be a non-empty array of non-empty header names',
    '"credentials" must be a boolean when it is present',
    '"maxAge" must be a non-negative number when it is present',
    '"preflight" must be a boolean when it is present',
  ]);
});

test("refuses a wildcard origin beside credentialed requests", async (): Promise<void> => {
  const CorsConfig = defineConfiguration(
    z
      .object({})
      .transform(() => ({ origins: ["*"], credentials: true }) as unknown as CorsConfiguration),
    "cors.wildcard",
  );

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  // A browser rejects `Access-Control-Allow-Origin: *` beside
  // `Access-Control-Allow-Credentials: true`, so the pair is not a policy a
  // browser honors. It is refused at boot, where the fix is, rather than served
  // as a response a reader would debug at the client.
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details.issues).toEqual([
    '"credentials" cannot be true while "origins" contains "*": a browser rejects that response',
  ]);
});

test("refuses a value that states no policy at all", async (): Promise<void> => {
  const CorsConfig = defineConfiguration(
    z.object({}).transform(() => null as unknown as CorsConfiguration),
    "cors.nopolicy",
  );

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details.issues).toEqual([
    '"origins" must be a non-empty array of non-empty origin strings',
  ]);
});

test("refuses two registrations that share a key", async (): Promise<void> => {
  const first = CorsModule.register({ configuration: policyOf("first"), source: {} });
  const second = CorsModule.register({ configuration: policyOf("second"), source: {} });

  @Module({ imports: [first, second] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  // The key is the module's identity, so two registrations that share one are not
  // two modules: the graph refuses the boot rather than mounting one and dropping
  // the other.
  expect(codeOf(failure)).toBe("DUPLICATE_MODULE");
  expect((failure as AponiaError).details).toMatchObject({ module: "PluginModule[cors]" });
});

test("mounts one plugin when two registrations resolve the same policy", async (): Promise<void> => {
  const first = CorsModule.register({
    configuration: policyOf("same-first"),
    source: {},
    key: "cors-same-first",
  });
  const second = CorsModule.register({
    configuration: policyOf("same-second"),
    source: {},
    key: "cors-same-second",
  });

  @Module({ imports: [first, second], controllers: [PingController] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // The wrapped plugin names itself and derives its Elysia identity from the
    // options it was handed, so two registrations that resolve equal options are
    // one mount rather than two: the plugin's own two `OPTIONS` routes, not four.
    expect(
      application.getNativeApplication().routes.filter((r) => r.method === "OPTIONS"),
    ).toHaveLength(2);

    // The two nodes are in the graph, which is the other half of the claim and
    // the half a route count cannot show: the boot got past the duplicate
    // refusal because the keys differ, so this is two declarations producing one
    // native mount rather than one declaration.
    const moduleIds = inspectAponiaApplication(AppModule).modules.map((module) => module.id);

    expect(moduleIds.filter((id) => id.startsWith("PluginModule[cors-same")).toSorted()).toEqual([
      "PluginModule[cors-same-first]",
      "PluginModule[cors-same-second]",
    ]);

    const response = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://app.example" } }),
    );

    expect(corsHeaders(response)["access-control-allow-origin"]).toBe("https://app.example");
  } finally {
    await application.close();
  }
});

test("mounts both plugins when two registrations resolve different policies", async (): Promise<void> => {
  const first = CorsModule.register({
    configuration: policyOf("distinct-first"),
    source: { CORS_ORIGINS: "https://a.example" },
    key: "cors-a",
  });
  const second = CorsModule.register({
    configuration: policyOf("distinct-second"),
    source: { CORS_ORIGINS: "https://b.example" },
    key: "cors-b",
  });

  @Module({ imports: [first, second], controllers: [PingController] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // Different options are a different identity, so neither mount is absorbed:
    // four `OPTIONS` routes, two per plugin.
    expect(
      application.getNativeApplication().routes.filter((r) => r.method === "OPTIONS"),
    ).toHaveLength(4);

    // Both policies answer, which is a union rather than a second policy: a
    // request from either origin is allowed by whichever plugin recognizes it.
    // The README states that this is not a way to run two policies and that one
    // registration per application is the supported shape.
    const fromA = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://a.example" } }),
    );
    const fromB = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://b.example" } }),
    );

    expect(corsHeaders(fromA)["access-control-allow-origin"]).toBe("https://a.example");
    expect(corsHeaders(fromB)["access-control-allow-origin"]).toBe("https://b.example");
  } finally {
    await application.close();
  }
});

test("cannot carry an origin a configuration cannot express, where the raw plugin can", async (): Promise<void> => {
  // A `RegExp` origin is code, not data: no environment variable holds one, so
  // the configuration this package validates has no field for it and the guard
  // refuses the value a transform produced in its place.
  const CorsConfig = defineConfiguration(
    z
      .object({})
      .transform(() => ({ origins: [/^https:\/\/.*\.example$/] }) as unknown as CorsConfiguration),
    "cors.regexp",
  );

  @Module({ imports: [CorsModule.register({ configuration: CorsConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details.issues).toEqual([
    '"origins" must be a non-empty array of non-empty origin strings',
  ]);

  // The same policy mounted as the raw plugin, which is the path the README
  // names for a reader who needs one. This is the boundary stated rather than
  // hidden: the package is an adapter over a configuration, and a rule that is a
  // function is outside what a configuration can be.
  const raw = PluginModule.register(cors({ origin: /^https:\/\/.*\.example$/ }), {
    key: "cors-raw-regexp",
  });

  @Module({ imports: [raw], controllers: [PingController] })
  class RawModule {}

  const application: AponiaApplication = await AponiaFactory.create(RawModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/ping", { headers: { Origin: "https://anything.example" } }),
    );

    expect(corsHeaders(response)["access-control-allow-origin"]).toBe("https://anything.example");
  } finally {
    await application.close();
  }
});
