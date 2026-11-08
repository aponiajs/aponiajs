import { afterEach, describe, expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  VERSION_NEUTRAL,
  Version,
  defineModule,
} from "@aponiajs/common";
import { AponiaFactory, defineControllerRoutes, type AponiaApplication } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("@Version", () => {
  test("mounts a controller under its URI version and lets a handler override it", async () => {
    @Controller("users")
    @Version("1")
    class UsersController {
      @Get()
      read(): string {
        return "v1";
      }

      @Get("special")
      @Version("2")
      special(): string {
        return "v2";
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(await (await application.handle(new Request("http://localhost/v1/users"))).text()).toBe(
      "v1",
    );
    expect(
      await (await application.handle(new Request("http://localhost/v2/users/special"))).text(),
    ).toBe("v2");
    expect((await application.handle(new Request("http://localhost/users"))).status).toBe(404);
  });

  test("mounts a neutral route at its plain path and keeps it out of every version", async () => {
    @Controller("mixed")
    @Version("1")
    class MixedController {
      @Get()
      latest(): string {
        return "v1";
      }

      @Get("health")
      @Version(VERSION_NEUTRAL)
      health(): string {
        return "neutral";
      }
    }

    @Controller("status")
    @Version(VERSION_NEUTRAL)
    class StatusController {
      @Get()
      status(): string {
        return "status";
      }
    }

    @Module({ controllers: [MixedController, StatusController] })
    class NeutralModule {}

    application = await AponiaFactory.create(NeutralModule, { logger: false });

    expect(await (await application.handle(new Request("http://localhost/v1/mixed"))).text()).toBe(
      "v1",
    );
    expect((await application.handle(new Request("http://localhost/mixed"))).status).toBe(404);
    expect(
      await (await application.handle(new Request("http://localhost/mixed/health"))).text(),
    ).toBe("neutral");
    expect((await application.handle(new Request("http://localhost/v1/mixed/health"))).status).toBe(
      404,
    );
    expect(await (await application.handle(new Request("http://localhost/status"))).text()).toBe(
      "status",
    );
    expect((await application.handle(new Request("http://localhost/v1/status"))).status).toBe(404);
  });

  test("negotiates a header or media-type version over URI mounts", async () => {
    @Controller("users")
    @Version("1")
    class UsersV1 {
      @Get()
      read(): string {
        return "v1";
      }

      @Post()
      create(@Body() body: { readonly name: string }): string {
        return `v1:${body.name}`;
      }
    }

    @Controller("users")
    @Version("2")
    class UsersV2 {
      @Get()
      read(): string {
        return "v2";
      }

      @Post()
      create(@Body() body: { readonly name: string }): string {
        return `v2:${body.name}`;
      }
    }

    @Controller("health")
    @Version(VERSION_NEUTRAL)
    class HealthController {
      @Get()
      read(): string {
        return "healthy";
      }
    }

    @Module({ controllers: [UsersV1, UsersV2, HealthController] })
    class VersionedModule {}

    const headerApplication = await AponiaFactory.create(VersionedModule, {
      logger: false,
      versioning: { type: "header", defaultVersion: "1" },
    });
    try {
      expect(
        await (await headerApplication.handle(new Request("http://localhost/users"))).text(),
      ).toBe("v1");
      expect(
        await (
          await headerApplication.handle(
            new Request("http://localhost/users", { headers: { "x-api-version": "2" } }),
          )
        ).text(),
      ).toBe("v2");
      expect(
        await (
          await headerApplication.handle(
            new Request("http://localhost/users", { headers: { "x-api-version": "v2" } }),
          )
        ).text(),
      ).toBe("v2");
      const created = await headerApplication.handle(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-version": "2" },
          body: JSON.stringify({ name: "ada" }),
        }),
      );
      expect(await created.text()).toBe("v2:ada");
      const missing = await headerApplication.handle(
        new Request("http://localhost/users", { headers: { "x-api-version": "9" } }),
      );
      expect(missing.status).toBe(400);
      expect(missing.headers.get("content-type")).toBe("application/problem+json");
      expect(await missing.json()).toMatchObject({
        code: "API_VERSION_NOT_FOUND",
        detail: "API version 9 is not available for GET /users.",
      });
      expect(
        await (
          await headerApplication.handle(
            new Request("http://localhost/health", { headers: { "x-api-version": "2" } }),
          )
        ).text(),
      ).toBe("healthy");
    } finally {
      await headerApplication.close();
    }

    const mediaApplication = await AponiaFactory.create(VersionedModule, {
      logger: false,
      versioning: { type: "media-type", defaultVersion: "1" },
    });
    try {
      expect(
        await (
          await mediaApplication.handle(
            new Request("http://localhost/users", {
              headers: { accept: "application/json; version=2" },
            }),
          )
        ).text(),
      ).toBe("v2");
      expect(
        await (
          await mediaApplication.handle(
            new Request("http://localhost/users", {
              headers: { accept: 'application/json; version="2"' },
            }),
          )
        ).text(),
      ).toBe("v2");
      expect(
        await (await mediaApplication.handle(new Request("http://localhost/users"))).text(),
      ).toBe("v1");
      expect(
        (
          await mediaApplication.handle(
            new Request("http://localhost/users", {
              headers: { accept: "application/json; version=9" },
            }),
          )
        ).status,
      ).toBe(400);
    } finally {
      await mediaApplication.close();
    }
  });

  test("refuses every invalid versioning option in one refusal", async () => {
    @Module({})
    class EmptyModule {}

    const failure = await AponiaFactory.create(EmptyModule, {
      logger: false,
      versioning: {
        type: "cookie" as unknown as "header",
        header: " ",
        parameter: " ",
        defaultVersion: " ",
      },
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "INVALID_CONFIGURATION_VALUE" });
    expect((failure as { details?: unknown }).details).toEqual({
      issues: [
        'versioning.type must be "uri", "header", or "media-type"',
        "versioning.header must be a non-empty string",
        "versioning.parameter must be a non-empty string",
        "versioning.defaultVersion must be a non-empty string when present",
      ],
    });
  });

  test("carries a version from a declared route plan", async () => {
    class DeclaredController {
      read(): string {
        return "declared";
      }
    }

    const declared = defineControllerRoutes(DeclaredController, {
      path: "declared",
      routes: [{ method: "GET", path: "/", propertyKey: "read", version: "3" }],
    });

    const AppModule = defineModule({
      id: "VersionedDeclaredModule",
      controllers: [declared],
    });

    const declaredApplication = await AponiaFactory.create(AppModule, { logger: false });
    try {
      expect(
        await (
          await declaredApplication.handle(new Request("http://localhost/v3/declared"))
        ).text(),
      ).toBe("declared");
    } finally {
      await declaredApplication.close();
    }
  });

  test("negotiates over parameterized paths and prefers a literal path", async () => {
    @Controller("users")
    @Version("1")
    class UsersV1 {
      @Get(":id")
      read(@Param("id") id: string): string {
        return `v1:${id}`;
      }
    }

    @Controller("users")
    @Version("2")
    class UsersV2 {
      @Get(":id")
      read(@Param("id") id: string): string {
        return `v2:${id}`;
      }

      @Get("me")
      me(): string {
        return "v2:me";
      }
    }

    @Module({ controllers: [UsersV1, UsersV2] })
    class VersionedModule {}

    application = await AponiaFactory.create(VersionedModule, {
      logger: false,
      versioning: { type: "header" },
    });

    const read = async (path: string, version: string): Promise<Response> =>
      application!.handle(
        new Request(`http://localhost${path}`, { headers: { "x-api-version": version } }),
      );

    expect(await (await read("/users/42", "1")).text()).toBe("v1:42");
    expect(await (await read("/users/42", "2")).text()).toBe("v2:42");
    expect(await (await read("/users/me", "2")).text()).toBe("v2:me");
    expect((await read("/users/me", "1")).status).toBe(400);
    expect((await read("/users/42", "9")).status).toBe(400);
  });

  test("negotiates over optional parameters and wildcard paths", async () => {
    @Controller("search")
    @Version("2")
    class SearchController {
      @Get(":term?")
      read(@Param("term") term: string | undefined): string {
        return `search:${term ?? "all"}`;
      }
    }

    @Controller("files")
    @Version("2")
    class FilesController {
      @Get("*")
      read(): string {
        return "files";
      }
    }

    @Module({ controllers: [SearchController, FilesController] })
    class WildcardModule {}

    application = await AponiaFactory.create(WildcardModule, {
      logger: false,
      versioning: { type: "header" },
    });

    const read = async (path: string): Promise<Response> =>
      application!.handle(
        new Request(`http://localhost${path}`, { headers: { "x-api-version": "2" } }),
      );

    expect(await (await read("/search")).text()).toBe("search:all");
    expect(await (await read("/search/pony")).text()).toBe("search:pony");
    expect(await (await read("/files/a/b.txt")).text()).toBe("files");
  });

  test("reads a custom header and media-type parameter name", async () => {
    @Controller("ping")
    class PingController {
      @Get()
      @Version("1")
      first(): string {
        return "v1";
      }

      @Get()
      @Version("2")
      second(): string {
        return "v2";
      }
    }

    @Module({ controllers: [PingController] })
    class PingModule {}

    const headerApplication = await AponiaFactory.create(PingModule, {
      logger: false,
      versioning: { type: "header", header: "api-version" },
    });
    try {
      const response = await headerApplication.handle(
        new Request("http://localhost/ping", { headers: { "api-version": "2" } }),
      );
      expect(await response.text()).toBe("v2");
    } finally {
      await headerApplication.close();
    }

    const mediaApplication = await AponiaFactory.create(PingModule, {
      logger: false,
      versioning: { type: "media-type", parameter: "v" },
    });
    try {
      const response = await mediaApplication.handle(
        new Request("http://localhost/ping", { headers: { accept: "application/json; v=2" } }),
      );
      expect(await response.text()).toBe("v2");
    } finally {
      await mediaApplication.close();
    }
  });
});
