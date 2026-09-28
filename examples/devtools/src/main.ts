import { devtoolsPlugin } from "@aponiajs/devtools";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { appLogger } from "./logger.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    logger: appLogger,
    // The one object reaches both, which is what makes `/__devtools/logs` carry
    // the boot's own lines. The surface mounts on this application's own route
    // table under `/__devtools`, on the address `listen` is given, so it is
    // reachable wherever the application is.
    plugins: [
      devtoolsPlugin({
        enabled: Bun.env.ENABLE_DEVTOOLS !== "false",
        logger: appLogger,
      }),
    ],
  });

  await application.listen(Number(Bun.env.PORT ?? 3110));
}

if (import.meta.main) {
  await bootstrap();
}
