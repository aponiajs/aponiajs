import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  type AponiaMiddleware,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../index.ts";

@Injectable()
class TagMiddleware implements AponiaMiddleware {
  use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    context.set.headers["x-tagged"] = "yes";
    context.set.headers["x-list"] = ["a", "b"];
    context.set.headers["x-skip"] = undefined;
    return next();
  }
}

@Injectable()
class BlockMiddleware implements AponiaMiddleware {
  use(): Response {
    return new Response("blocked", { status: 418 });
  }
}

@Controller("plain")
class PlainController {
  @Get()
  run(): string {
    return "ok";
  }

  @Get("free")
  free(): string {
    return "free";
  }
}

@Module({
  controllers: [PlainController],
  providers: [TagMiddleware, BlockMiddleware],
})
class MiddlewareModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TagMiddleware).exclude("/plain/free").forRoutes("/plain");
  }
}

@Module({ controllers: [PlainController], providers: [BlockMiddleware] })
class BlockingModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BlockMiddleware).forRoutes("/plain");
  }
}

describe("Hono middleware and listener", () => {
  test("runs module middleware natively and honours exclusions", async () => {
    const application = await AponiaFactory.create(MiddlewareModule, { logger: false });
    const native = application.getNativeApplication();

    const tagged = await native.request("/plain");
    expect(tagged.status).toBe(200);
    expect(tagged.headers.get("x-tagged")).toBe("yes");
    expect(tagged.headers.get("x-list")).toBe("a, b");
    expect(tagged.headers.get("x-skip")).toBeNull();

    const excluded = await native.request("/plain/free");
    expect(excluded.status).toBe(200);
    expect(excluded.headers.get("x-tagged")).toBeNull();
    await application.close();
  });

  test("lets a middleware answer the request", async () => {
    const application = await AponiaFactory.create(BlockingModule, { logger: false });
    const response = await application.getNativeApplication().request("/plain");

    expect(response.status).toBe(418);
    expect(await response.text()).toBe("blocked");
    await application.close();
  });

  test("listens on Bun's server, answers, and closes", async () => {
    const application = await AponiaFactory.create(MiddlewareModule, { logger: false });
    const listening = await application.listen(0, { shutdownSignals: false });

    expect(listening).toBe(application);
    const response = await fetch(`${application.getUrl()}/plain`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    await application.close();
    await application.close();
  });
});
