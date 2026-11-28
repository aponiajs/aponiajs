import { All, Controller, Get, Header, HttpCode, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("surface")
class SurfaceController {
  @All("webhook")
  receive(): { readonly method: string } {
    return { method: "any" };
  }

  @Get("declared")
  @Header("cache-control", "no-store")
  @HttpCode(202)
  declared(): { readonly ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [SurfaceController] })
class SurfaceModule {}

test("the Vite+ lane mounts an ALL route and applies declared response metadata", async () => {
  const application = await AponiaFactory.create(SurfaceModule, { logger: false });

  try {
    const any = await application.handle(
      new Request("http://localhost/surface/webhook", { method: "PATCH" }),
    );
    expect(any.status).toBe(200);
    expect(await any.json()).toEqual({ method: "any" });

    const declared = await application.handle(new Request("http://localhost/surface/declared"));
    expect(declared.status).toBe(202);
    expect(declared.headers.get("cache-control")).toBe("no-store");
  } finally {
    await application.close();
  }
});
