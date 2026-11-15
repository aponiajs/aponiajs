import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "@aponiajs/microservices";
import { AppModule } from "./app.module.ts";

export const transport = new InMemoryTransport();

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    microservices: [transport],
  });
  const port = Number(Bun.env.PORT ?? 3140);
  await application.listen(port);
}

if (import.meta.main) {
  await bootstrap();
}
