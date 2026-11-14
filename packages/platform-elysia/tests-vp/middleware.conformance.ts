import {
  Controller,
  Get,
  Module,
  type AponiaMiddleware,
  type AponiaModule,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

class HeaderTagMiddleware implements AponiaMiddleware {
  async use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    context.set.headers["x-vp-middleware"] = "active";
    return await next();
  }
}

class BlockSecretMiddleware implements AponiaMiddleware {
  async use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    if (context.request.url.includes("forbidden")) {
      return new Response("blocked", { status: 403 });
    }
    return await next();
  }
}

@Controller("vp-middleware")
class VpMiddlewareController {
  @Get("ok")
  getOk() {
    return { status: "success" };
  }

  @Get("forbidden")
  getForbidden() {
    return { status: "never" };
  }
}

@Module({
  controllers: [VpMiddlewareController],
})
class VpMiddlewareModule implements AponiaModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HeaderTagMiddleware, BlockSecretMiddleware).forRoutes(VpMiddlewareController);
  }
}

test("the Vite+ lane executes middleware and sets headers", async () => {
  const application = await AponiaFactory.create(VpMiddlewareModule, { logger: false });

  try {
    const response = await application.handle(new Request("http://localhost/vp-middleware/ok"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vp-middleware")).toBe("active");
    expect(await response.json()).toEqual({ status: "success" });
  } finally {
    await application.close();
  }
});

test("the Vite+ lane allows middleware to short-circuit responses", async () => {
  const application = await AponiaFactory.create(VpMiddlewareModule, { logger: false });

  try {
    const response = await application.handle(
      new Request("http://localhost/vp-middleware/forbidden"),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("blocked");
  } finally {
    await application.close();
  }
});
