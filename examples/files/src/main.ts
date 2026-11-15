import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { configureStaticAssets } from "./static-assets.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    configureNative: configureStaticAssets,
  });
  await application.listen(Number(Bun.env.PORT ?? 3080));
}

if (import.meta.main) {
  await bootstrap();
}
