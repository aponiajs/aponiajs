import { devtoolsPlugin } from "@aponiajs/devtools";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { appLogger } from "./logger.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    logger: appLogger,
    // The one object reaches both, which is what makes `/__devtools/logs` carry
    // the boot's own lines. The surface binds loopback and reports rather than
    // silences a `host` that widens it.
    plugins: [
      devtoolsPlugin({
        enabled: Bun.env.ENABLE_DEVTOOLS !== "false",
        port: Number(Bun.env.DEVTOOLS_PORT ?? 3111),
        logger: appLogger,
      }),
    ],
  });

  await application.listen(Number(Bun.env.PORT ?? 3110));
}

if (import.meta.main) {
  await bootstrap();
}
