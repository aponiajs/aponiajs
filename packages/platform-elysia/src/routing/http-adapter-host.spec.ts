import { expect, test } from "bun:test";
import { Injectable, Module } from "@aponiajs/common";
import { HttpAdapterHost } from "@aponiajs/common";
import { AponiaFactory } from "../index.ts";

@Injectable()
class NativeService {
  constructor(readonly host: HttpAdapterHost) {}
}

@Module({ providers: [NativeService], exports: [NativeService] })
class AppModule {}

test("a provider injects the running platform's native application", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const service = application.get(NativeService) as NativeService;

    expect(service.host.httpAdapter).toBe(application.getHttpAdapter());
    const replacement = { name: "replacement" };
    service.host.setHttpAdapter(replacement);
    expect(service.host.httpAdapter).toBe(replacement as never);
  } finally {
    await application.close();
  }
});

test("reading the adapter before one is set fails with the documented code", () => {
  const host = new HttpAdapterHost();

  expect(() => host.httpAdapter).toThrow(
    expect.objectContaining({ code: "INVALID_NATIVE_APPLICATION" }),
  );
});
