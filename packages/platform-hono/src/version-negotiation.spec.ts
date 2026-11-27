import { describe, expect, test } from "bun:test";
import { Controller, Get, Module, Version } from "@aponiajs/common";
import { createVersionNegotiator } from "@aponiajs/common";
import { createBootstrapFactory } from "./application/bootstrap.ts";
import { fakeHost } from "../test/fixtures/fake-host.ts";

@Controller("users")
class UsersController {
  @Version("1")
  @Get(":id")
  v1(): string {
    return "v1";
  }

  @Version("2")
  @Get("mine")
  v2(): string {
    return "v2";
  }
}

@Controller("status")
class StatusController {
  @Get()
  neutral(): string {
    return "neutral";
  }
}

@Module({ controllers: [UsersController, StatusController] })
class UsersModule {}

async function boot(options: Record<string, unknown> = {}) {
  return await createBootstrapFactory(fakeHost()).create(UsersModule, {
    logger: false,
    ...options,
  } as never);
}

describe("version negotiation", () => {
  test("rewrites a header request to its versioned mount", async () => {
    const application = await boot({ versioning: { type: "header" } });
    try {
      const response = await application.handle(
        new Request("http://localhost/users/42", { headers: { "x-api-version": "1" } }),
      );
      expect(await response.text()).toBe("v1");
    } finally {
      await application.close();
    }
  });

  test("reads a media-type parameter", async () => {
    const application = await boot({ versioning: { type: "media-type" } });
    try {
      const response = await application.handle(
        new Request("http://localhost/users/mine", {
          headers: { accept: "application/json;version=2" },
        }),
      );
      expect(await response.text()).toBe("v2");
    } finally {
      await application.close();
    }
  });

  test("applies the default version when the request states none", async () => {
    const application = await boot({
      versioning: { type: "header", defaultVersion: "1" },
    });
    try {
      const response = await application.handle(new Request("http://localhost/users/42"));
      expect(await response.text()).toBe("v1");
    } finally {
      await application.close();
    }
  });

  test("refuses a version no handler declared", async () => {
    const application = await boot({ versioning: { type: "header" } });
    try {
      const response = await application.handle(
        new Request("http://localhost/users/42", { headers: { "x-api-version": "9" } }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "API_VERSION_NOT_FOUND" });
    } finally {
      await application.close();
    }
  });

  test("leaves an unversioned route alone", async () => {
    const application = await boot({ versioning: { type: "header" } });
    try {
      const response = await application.handle(
        new Request("http://localhost/status", { headers: { "x-api-version": "9" } }),
      );
      expect(await response.text()).toBe("neutral");
    } finally {
      await application.close();
    }
  });

  test("composes with the application prefix", async () => {
    const application = await boot({
      prefix: "/api",
      versioning: { type: "header" },
    });
    try {
      const response = await application.handle(
        new Request("http://localhost/api/users/42", { headers: { "x-api-version": "1" } }),
      );
      expect(await response.text()).toBe("v1");
    } finally {
      await application.close();
    }
  });

  test("refuses invalid options at boot", async () => {
    const error = await boot({ versioning: { type: "header", header: "" } }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ code: "INVALID_CONFIGURATION_VALUE" });
  });
});

describe("version negotiator units", () => {
  test("answers undefined without header or media-type versioning", () => {
    expect(createVersionNegotiator([], undefined)).toBeUndefined();
    expect(createVersionNegotiator([], { type: "uri" })).toBeUndefined();
  });

  test("answers undefined when no route declares a version", () => {
    expect(
      createVersionNegotiator([{ method: "GET", path: "/things" }], { type: "header" }),
    ).toBeUndefined();
  });

  test("skips a versioned route whose path is not under its version segment", () => {
    expect(
      createVersionNegotiator([{ method: "GET", path: "/elsewhere", version: "1" }], {
        type: "header",
      }),
    ).toBeUndefined();
  });

  test("leaves a request outside the prefix and an unversioned path alone", () => {
    const negotiate = createVersionNegotiator(
      [{ method: "GET", path: "/v1/things", version: "1" }],
      { type: "header" },
      "/api",
    );
    expect(negotiate).toBeDefined();
    expect(negotiate?.(new Request("http://localhost/other/things"))).toBeUndefined();
    expect(
      negotiate?.(
        new Request("http://localhost/api/elsewhere", { headers: { "x-api-version": "1" } }),
      ),
    ).toBeUndefined();
  });

  test("rewrites the root path of a versioned mount", () => {
    const negotiate = createVersionNegotiator([{ method: "GET", path: "/v2", version: "2" }], {
      type: "header",
    });
    const rewritten = negotiate?.(
      new Request("http://localhost/", { headers: { "x-api-version": "2" } }),
    );

    expect(rewritten).toBeInstanceOf(Request);
    expect((rewritten as Request).url).toBe("http://localhost/v2");
  });

  test("answers undefined for a media-type request with no Accept parameter", () => {
    const negotiate = createVersionNegotiator(
      [{ method: "GET", path: "/v1/things", version: "1" }],
      { type: "media-type" },
    );
    expect(negotiate?.(new Request("http://localhost/things"))).toBeUndefined();
    expect(
      negotiate?.(
        new Request("http://localhost/things", { headers: { accept: "application/json" } }),
      ),
    ).toBeUndefined();
  });
});
