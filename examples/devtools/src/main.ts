import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createAppModule } from "./app.module.ts";
import { appLogger } from "./logger.ts";

export async function bootstrap(): Promise<void> {
  const devtools = {
    enabled: Bun.env.ENABLE_DEVTOOLS !== "false",
    logger: appLogger,
  };

  // The one logger object reaches both places: the factory writes its bootstrap
  // lines through it, and the devtools registration patches it in place so
  // `/__devtools/logs` carries those lines too. The surface mounts on this
  // application's own route table under `/__devtools`, on the address `listen` is
  // given, so it is reachable wherever the application is.
  const application = await AponiaFactory.create(createAppModule({ devtools }), {
    logger: appLogger,
  });

  await application.listen(Number(Bun.env.PORT ?? 3110));
}

if (import.meta.main) {
  await bootstrap();
}
