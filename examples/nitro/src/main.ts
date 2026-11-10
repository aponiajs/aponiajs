import { AponiaFactory } from "@aponiajs/platform-elysia";
import { toNitroHandler } from "@aponiajs/nitro";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, { logger: false });

export const nitroHandler = toNitroHandler(application);

export async function bootstrap(): Promise<void> {
  const port = Number(Bun.env.PORT ?? 3160);
  await application.listen(port);
}

if (import.meta.main) {
  await bootstrap();
}
