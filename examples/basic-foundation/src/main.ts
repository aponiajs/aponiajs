import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  const port = Number(Bun.env.PORT ?? 3000);
  await application.listen(port);
}

if (import.meta.main) {
  await bootstrap();
}
