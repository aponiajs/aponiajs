import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { AppConfig } from "./config.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  // The port is the validated configuration's, read back from the container the
  // boot built. A `PORT` the schema refuses fails the boot above, before this
  // line runs, so a malformed value never reaches `listen`.
  await application.listen(application.get(AppConfig).port);
}

if (import.meta.main) {
  await bootstrap();
}
