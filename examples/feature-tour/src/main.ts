import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

/**
 * Bootstrap with the application-level escape hatch: `configureNative` receives
 * the root Elysia instance and must return the same one.
 */
export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    configureNative: (native) => native.onError(({ code }) => ({ code: String(code) })),
  });

  const port = Number(Bun.env.PORT ?? 3100);
  await application.listen(port);
}

if (import.meta.main) {
  await bootstrap();
}
