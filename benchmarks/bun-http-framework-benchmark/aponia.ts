import { defineModule } from "@aponiajs/common";
import { AponiaFactory, defineElysiaController } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

interface JsonBody {
  readonly hello: string;
}

class BenchmarkController {
  ping(): string {
    return "Hi";
  }

  query(id: string, name: string | undefined): string {
    return `${id} ${name ?? ""}`;
  }

  body(body: JsonBody): JsonBody {
    return body;
  }
}

const benchmarkController = defineElysiaController(BenchmarkController, {
  inject: [],
  buildPlugin: (controller) =>
    new Elysia()
      .get("/", ({ set }) => {
        set.headers["content-type"] = "text/plain";
        return controller.ping();
      })
      .get("/id/:id", ({ params, query, set }) => {
        set.headers["content-type"] = "text/plain";
        set.headers["x-powered-by"] = "benchmark";
        return controller.query(params.id, query.name);
      })
      .post("/json", ({ body }) => controller.body(body as JsonBody), {
        parse: "json",
      }),
});

const benchmarkModule = defineModule({
  id: "BenchmarkModule",
  controllers: [benchmarkController],
});

export async function createBenchmarkApplication() {
  return AponiaFactory.create(benchmarkModule, { logger: false });
}

if (import.meta.main) {
  const application = await createBenchmarkApplication();
  await application.listen(3000);
}
