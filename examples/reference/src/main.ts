import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppConfig } from "./config.ts";
import { AppModule } from "./app.module.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    health: true,
  });
  const port = application.get(AppConfig).port;
  await application.listen(port);
}

if (import.meta.main) {
  await bootstrap();
}
