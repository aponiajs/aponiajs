/* oxlint-disable typescript/no-unsafe-declaration-merging -- Validation models are metadata tokens for Elysia-validated plain objects; Aponia never constructs them. */

import { expect, test } from "bun:test";
import {
  AponiaError,
  Body,
  Controller,
  Get,
  MessageBody,
  Module,
  Param,
  Post,
  SubscribeMessage,
  Validation,
  WebSocketGateway,
  defineConfiguration,
  type AponiaErrorCode,
} from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { t } from "elysia";
import { z } from "zod";
import { OpenApiModule } from "../src/index.ts";
import type { OpenApiConfiguration } from "../src/index.ts";
import type { ServedDocument } from "./served-document.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

/** The document one application serves at one path. */
async function serve(application: AponiaApplication, path: string): Promise<ServedDocument> {
  const response = await application.handle(new Request(`http://localhost${path}`));

  expect(response.status, `the document at ${path} was not served`).toBe(200);

  return (await response.json()) as ServedDocument;
}

/**
 * A metadata declaration of the shape most cases below reuse.
 *
 * A `defineConfiguration` result rather than a literal options object, which is
 * the contract under test: the document's metadata is validated once at boot,
 * from whatever the application declared the source to be. The defaults are what
 * make `source: {}` a complete declaration, so a case that is about the document
 * does not have to spell the metadata out.
 */
function metadataOf(name: string, description = "declared") {
  return defineConfiguration(
    z
      .object({
        OPENAPI_TITLE: z.string().min(1).default("OpenAPI metadata"),
        OPENAPI_VERSION: z.string().min(1).default("2.1.0"),
        OPENAPI_DESCRIPTION: z.string().default(description),
      })
      .transform(({ OPENAPI_TITLE, OPENAPI_VERSION, OPENAPI_DESCRIPTION }) => ({
        info: {
          title: OPENAPI_TITLE,
          version: OPENAPI_VERSION,
          description: OPENAPI_DESCRIPTION,
        },
      })),
    `openapi.${name}`,
  );
}

/** The same declaration with no defaults, so an empty source is what a schema refuses. */
function requiredMetadata(name: string) {
  return defineConfiguration(
    z
      .object({ OPENAPI_TITLE: z.string().min(1), OPENAPI_VERSION: z.string().min(1) })
      .transform(({ OPENAPI_TITLE, OPENAPI_VERSION }) => ({
        info: { title: OPENAPI_TITLE, version: OPENAPI_VERSION },
      })),
    `openapi.${name}`,
  );
}

/** A declaration that states no description at all, whichever source it validates. */
function metadataWithoutDescription(name: string) {
  return defineConfiguration(
    z
      .object({
        OPENAPI_TITLE: z.string().min(1).default("OpenAPI metadata"),
        OPENAPI_VERSION: z.string().min(1).default("2.1.0"),
      })
      .transform(({ OPENAPI_TITLE, OPENAPI_VERSION }) => ({
        info: { title: OPENAPI_TITLE, version: OPENAPI_VERSION },
      })),
    `openapi.${name}`,
  );
}

const createWidgetSchema = t.Object({ name: t.String({ minLength: 2 }) });
const widgetResponseSchema = t.Object({ id: t.String(), name: t.String() });
const errorResponseSchema = t.Object({ message: t.String() });

@Validation(createWidgetSchema)
class CreateWidget {}
interface CreateWidget {
  readonly name: string;
}

@Validation(widgetResponseSchema)
class WidgetResponse {}
interface WidgetResponse {
  readonly id: string;
  readonly name: string;
}

@Validation(errorResponseSchema)
class ErrorResponse {}
interface ErrorResponse {
  readonly message: string;
}

@Controller("widgets")
class WidgetsController {
  @Get(":id")
  read(@Param("id") id: string): WidgetResponse {
    return { id, name: "widget" };
  }

  @Post("/", { body: CreateWidget, response: { 201: WidgetResponse, 404: ErrorResponse } })
  create(@Body() body: CreateWidget): WidgetResponse {
    return { id: "1", name: body.name };
  }

  @Get("/health")
  health(): string {
    return "ok";
  }
}

test("serves the document its validated configuration declared, where the registration mounted it", async (): Promise<void> => {
  const OpenApiConfig = metadataOf("docs", "from a validated configuration");

  @Module({
    imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {}, path: "/docs" })],
    controllers: [WidgetsController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const document = await serve(application, "/docs/json");

    // The three fields the configuration produced, parsed rather than copied: a
    // document whose info came from anywhere but the validated value would fail
    // here.
    expect(document.info).toEqual({
      title: "OpenAPI metadata",
      version: "2.1.0",
      description: "from a validated configuration",
    });
    expect(document.openapi.startsWith("3.")).toBe(true);

    // The UI the wrapped plugin serves is mounted at the path the registration
    // chose, so the two spellings of the mount point are the registration's.
    const page = await application.handle(new Request("http://localhost/docs"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect((await page.text()).length).toBeGreaterThan(0);

    // The default path is not mounted, which is what makes the option's effect
    // observable rather than incidental.
    expect((await application.handle(new Request("http://localhost/openapi/json"))).status).toBe(
      404,
    );

    // The module declares the configuration and exports it, so the application
    // reads back the same value the document carries.
    expect(application.get(OpenApiConfig).info.title).toBe("OpenAPI metadata");
  } finally {
    await application.close();
  }
});

test("reflects the body and status-specific response schemas a controller declared", async (): Promise<void> => {
  const OpenApiConfig = metadataOf("schemas");

  @Module({
    imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {} })],
    controllers: [WidgetsController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const document = await serve(application, "/openapi/json");
    const create = document.paths["/widgets"]?.post;

    // The one-schema validation model the route declared, lowered by the
    // platform into the hook the plugin reads. Nothing about the model class
    // survives into the document, which is what takes the metadata read off the
    // request path.
    expect(create?.requestBody?.content["application/json"]?.schema).toEqual({
      type: "object",
      properties: { name: { minLength: 2, type: "string" } },
      required: ["name"],
    });

    // The status-specific response map, both statuses: one operation, several
    // answers, which is the slot a single response schema could not state.
    expect(create?.responses?.["201"]?.content?.["application/json"]?.schema).toEqual({
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
    });
    expect(create?.responses?.["404"]?.content?.["application/json"]?.schema).toEqual({
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    });

    // A path parameter the route declared, read from the compiled route rather
    // than from a declaration this package made.
    expect(document.paths["/widgets/{id}"]?.get?.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);

    // A route that declares nothing is still an operation, which is the case a
    // document built from schemas alone would drop.
    expect(document.paths["/widgets/health"]?.get?.operationId).toBe("getWidgetsHealth");
    expect(document.paths["/widgets/health"]?.get?.requestBody).toBeUndefined();

    // The document's `components.schemas` is the platform's model registry, and
    // the platform registers no model: every declared schema is inlined above
    // instead. Stated as an assertion because the README states it too.
    expect(document.components.schemas).toEqual({});
  } finally {
    await application.close();
  }
});

test("serves a document that states no description when the configuration declares none", async (): Promise<void> => {
  const OpenApiConfig = metadataWithoutDescription("nodescription");

  @Module({ imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {} })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const document = await serve(application, "/openapi/json");

    // The wrapped plugin fills an absent description with "Development
    // documentation". This package overrides that default, because a document
    // making a claim the application never declared is exactly what a generated
    // document must not do.
    expect(document.info).toEqual({ title: "OpenAPI metadata", version: "2.1.0" });
  } finally {
    await application.close();
  }
});

test("keeps a WebSocket gateway's route out of the document", async (): Promise<void> => {
  @WebSocketGateway("/events")
  class EventsGateway {
    @SubscribeMessage("events.echo")
    echo(@MessageBody("value") value: string): string {
      return value;
    }
  }

  const OpenApiConfig = metadataOf("gateways");

  @Module({
    imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {} })],
    controllers: [WidgetsController],
    providers: [EventsGateway],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const document = await serve(application, "/openapi/json");

    // The platform mounts a gateway as a route whose method really is `ws`, and
    // `ws` is not an OpenAPI path-item field. Left in, it is an object no
    // validator accepts, so the document excludes it and the HTTP operations
    // stand alone.
    expect(Object.keys(document.paths)).not.toContain("/events");
    expect(Object.keys(document.paths)).toEqual(["/widgets/{id}", "/widgets", "/widgets/health"]);
  } finally {
    await application.close();
  }
});

test("refuses a boot whose configuration the schema rejects", async (): Promise<void> => {
  const OpenApiConfig = requiredMetadata("required");

  @Module({
    imports: [
      OpenApiModule.register({
        configuration: OpenApiConfig,
        // `OPENAPI_TITLE` and `OPENAPI_VERSION` have no default, so the source
        // is what the schema refuses.
        source: {},
      }),
    ],
    controllers: [WidgetsController],
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
  expect((failure as AponiaError).details).toMatchObject({ configuration: "openapi.required" });
  expect((failure as AponiaError).details.issues).toHaveLength(2);
});

test("refuses metadata only a runtime could produce, naming every field at once", async (): Promise<void> => {
  const OpenApiConfig = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          info: { title: "   ", version: "", description: 42 },
        }) as unknown as OpenApiConfiguration,
    ),
    "openapi.malformed",
  );

  @Module({ imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "openapi.malformed" });

  // Every field that fails, not just the first: a boot that names one problem at
  // a time is a boot a maintainer runs three times.
  expect((failure as AponiaError).details.issues).toEqual([
    '"info.title" must be a non-empty string',
    '"info.version" must be a non-empty string',
    '"info.description" must be a string when it is present',
  ]);
});

test("refuses a value that states no metadata at all", async (): Promise<void> => {
  const OpenApiConfig = defineConfiguration(
    z.object({}).transform(() => ({}) as unknown as OpenApiConfiguration),
    "openapi.noinfo",
  );

  @Module({ imports: [OpenApiModule.register({ configuration: OpenApiConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details.issues).toEqual([
    '"info" must be an object stating the document title and version',
  ]);
});

test("refuses a mount path that is not an absolute path while the registration runs", (): void => {
  const OpenApiConfig = metadataOf("path");

  let failure: unknown;

  try {
    OpenApiModule.register({ configuration: OpenApiConfig, path: "docs" });
  } catch (error) {
    failure = error;
  }

  // A `TypeError` rather than an `AponiaError`, because a mount path is written
  // in source where a wrong one is a programming mistake, while the metadata is
  // data an environment supplies and is refused with a code and an issue list.
  expect(failure).toBeInstanceOf(TypeError);
  expect((failure as TypeError).message).toContain("absolute path");

  // The default is not a mistake, so it must not be refused by the same check.
  expect(OpenApiModule.register({ configuration: OpenApiConfig, path: "/openapi" })).toBeDefined();
});

test("refuses two registrations that share a key", async (): Promise<void> => {
  const first = OpenApiModule.register({ configuration: metadataOf("first"), source: {} });
  const second = OpenApiModule.register({ configuration: metadataOf("second"), source: {} });

  @Module({ imports: [first, second] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  // The key is the module's identity, so two registrations that share one are not
  // two modules: the graph refuses the boot rather than mounting one of them and
  // dropping the other.
  expect(codeOf(failure)).toBe("DUPLICATE_MODULE");
  expect((failure as AponiaError).details).toMatchObject({ module: "PluginModule[openapi]" });
});

test("mounts one document when an application declares two registrations", async (): Promise<void> => {
  const OpenApiConfig = metadataOf("shared");

  const first = OpenApiModule.register({
    configuration: OpenApiConfig,
    source: { OPENAPI_TITLE: "First", OPENAPI_VERSION: "1.0.0" },
    path: "/first",
    key: "openapi-first",
  });
  const second = OpenApiModule.register({
    configuration: OpenApiConfig,
    source: { OPENAPI_TITLE: "Second", OPENAPI_VERSION: "2.0.0" },
    path: "/second",
    key: "openapi-second",
  });

  @Module({ imports: [first, second], controllers: [WidgetsController] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    // Both modules mount, and both configurations validate — which is what a
    // distinct key buys, and what the profile of a duplicate key above does not.
    // What it does not buy is a second document. The wrapped plugin is a named
    // plugin, and Elysia identifies a mounted plugin by a hash derived from that
    // name and skips a second mount of it, so the second registration's document
    // is never served. The first entry in `imports` is the one that mounts; the
    // graph does not refuse the boot, so the README states the limitation rather
    // than leaving a reader to discover it from a 404.
    expect((await serve(application, "/first/json")).info.title).toBe("First");
    expect((await application.handle(new Request("http://localhost/second/json"))).status).toBe(
      404,
    );
    expect((await application.handle(new Request("http://localhost/second"))).status).toBe(404);

    // The two modules both export this configuration token, so reading it back is
    // the ambiguity the graph names rather than a winner it picks — the second
    // half of the same limitation.
    let failure: unknown;

    try {
      application.get(OpenApiConfig);
    } catch (error) {
      failure = error;
    }

    expect(codeOf(failure)).toBe("AMBIGUOUS_PROVIDER");
  } finally {
    await application.close();
  }
});

test("reflects every declared schema slot on the operation that declared it", async (): Promise<void> => {
  const listQuerySchema = t.Object({ limit: t.Integer() });
  const headerSchema = t.Object({ "x-tenant": t.String() });
  const cookieSchema = t.Object({ session: t.String() });
  const okSchema = t.Object({ ok: t.Boolean() });

  @Validation(listQuerySchema)
  class ListQuery {}
  interface ListQuery {
    readonly limit: number;
  }

  @Validation(headerSchema)
  class Headers {}
  interface Headers {
    readonly "x-tenant": string;
  }

  @Validation(cookieSchema)
  class Cookies {}
  interface Cookies {
    readonly session: string;
  }

  @Validation(okSchema)
  class Ok {}
  interface Ok {
    readonly ok: boolean;
  }

  @Controller("reports")
  class ReportsController {
    @Get("/", {
      query: ListQuery,
      headers: Headers,
      cookie: Cookies,
      params: t.Object({ report: t.String() }),
      response: Ok,
    })
    read(): Ok {
      return { ok: true };
    }
  }

  @Module({
    imports: [OpenApiModule.register({ configuration: metadataOf("slots"), source: {} })],
    controllers: [ReportsController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const document = await serve(application, "/openapi/json");
    const operation = document.paths["/reports"]?.get;

    // A path, a query, a header, and a cookie are four containers the operation
    // states its parameters under, and the plugin lowers each declared schema
    // into the one it belongs to, in the order the route declared them.
    expect(operation?.parameters).toEqual([
      { name: "report", in: "path", required: true, schema: { type: "string" } },
      { name: "limit", in: "query", required: true, schema: { type: "integer" } },
      { name: "x-tenant", in: "header", required: true, schema: { type: "string" } },
      { name: "session", in: "cookie", required: true, schema: { type: "string" } },
    ]);

    // A single validator is the 200 answer, which is the spelling a route uses
    // when one status is the whole contract.
    expect(operation?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    });
  } finally {
    await application.close();
  }
});
