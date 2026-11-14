import { Controller, Get, Module, Version } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("users")
@Version("1")
class UsersV1 {
  @Get()
  read(): string {
    return "v1";
  }
}

@Controller("users")
@Version("2")
class UsersV2 {
  @Get()
  read(): string {
    return "v2";
  }
}

@Module({ controllers: [UsersV1, UsersV2] })
class VersionedModule {}

test("negotiates a header version at the fetch boundary", async () => {
  const application = await AponiaFactory.create(VersionedModule, {
    logger: false,
    versioning: { type: "header", defaultVersion: "1" },
  });
  try {
    const plain = await application.handle(new Request("http://localhost/users"));
    const second = await application.handle(
      new Request("http://localhost/users", { headers: { "x-api-version": "2" } }),
    );
    const missing = await application.handle(
      new Request("http://localhost/users", { headers: { "x-api-version": "9" } }),
    );

    expect(await plain.text()).toBe("v1");
    expect(await second.text()).toBe("v2");
    expect(missing.status).toBe(400);
  } finally {
    await application.close();
  }
});

test("negotiates a media-type version", async () => {
  const application = await AponiaFactory.create(VersionedModule, {
    logger: false,
    versioning: { type: "media-type" },
  });
  try {
    const second = await application.handle(
      new Request("http://localhost/users", {
        headers: { accept: "application/json; version=2" },
      }),
    );

    expect(await second.text()).toBe("v2");
  } finally {
    await application.close();
  }
});
