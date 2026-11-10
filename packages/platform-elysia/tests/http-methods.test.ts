import { expect, test } from "bun:test";
import {
  Controller,
  Delete,
  Get,
  Head,
  Module,
  Options,
  Patch,
  Post,
  Put,
  Render,
  VIEW_ENGINE,
  provideValue,
  type ViewEngine,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

@Controller("methods")
class MethodController {
  @Delete()
  removeItem(): string {
    return "DELETE";
  }

  @Get()
  readItem(): string {
    return "GET";
  }

  @Head()
  inspectItem(): string {
    return "HEAD";
  }

  @Options()
  describeItem(): string {
    return "OPTIONS";
  }

  @Patch()
  amendItem(): string {
    return "PATCH";
  }

  @Post()
  createItem(): string {
    return "POST";
  }

  @Put()
  replaceItem(): string {
    return "PUT";
  }
}

@Module({ controllers: [MethodController] })
class MethodModule {}

const methods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;

test("maps every HTTP method decorator", async () => {
  const application = await AponiaFactory.create(MethodModule, { logger: false });

  for (const method of methods) {
    const response = await application.handle(new Request("http://localhost/methods", { method }));

    expect(response.status).toBe(200);
    if (method !== "HEAD") {
      expect(await response.text()).toBe(method);
    }
  }
});
@Controller("rendered")
class RenderedController {
  @Get()
  @Render("test-view")
  renderPage() {
    return { ok: true };
  }
}

const dummyEngine: ViewEngine = {
  render: (template, data) =>
    `Rendered ${template}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
};

@Controller("primitive-render")
class PrimitiveRenderController {
  @Get()
  @Render("primitive")
  renderText() {
    return "hello world";
  }
}

@Controller("unregistered-render")
class UnregisteredRenderController {
  @Get()
  @Render("missing")
  renderFail() {
    return {};
  }
}

@Module({
  controllers: [UnregisteredRenderController],
})
class UnregisteredRenderModule {}

@Module({
  controllers: [RenderedController],
  providers: [provideValue(VIEW_ENGINE, dummyEngine)],
})
class RenderedModule {}

test("renders route view via registered VIEW_ENGINE and sets content-type", async () => {
  const app = await AponiaFactory.create(RenderedModule, { logger: false });
  try {
    const res = await app.handle(new Request("http://localhost/rendered"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe('Rendered test-view: {"ok":true}');
  } finally {
    await app.close();
  }
});

test("renders non-object view data as value wrapper", async () => {
  @Module({
    controllers: [PrimitiveRenderController],
    providers: [provideValue(VIEW_ENGINE, dummyEngine)],
  })
  class PrimModule {}

  const app = await AponiaFactory.create(PrimModule, { logger: false });
  try {
    const res = await app.handle(new Request("http://localhost/primitive-render"));
    expect(await res.text()).toBe('Rendered primitive: {"value":"hello world"}');
  } finally {
    await app.close();
  }
});

test("fails route when @Render() is declared but no VIEW_ENGINE is provided", async () => {
  const failure = await AponiaFactory.create(UnregisteredRenderModule, { logger: false }).catch(
    (err: unknown) => err,
  );
  expect(failure).toBeInstanceOf(Error);
});
