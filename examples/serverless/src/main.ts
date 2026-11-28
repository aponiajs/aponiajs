import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createLambdaHandler, toFetchHandler } from "@aponiajs/serverless";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, { logger: false });

export const fetch = toFetchHandler(application);
export const handler = createLambdaHandler(application);

export async function bootstrap(): Promise<void> {
  const port = Number(Bun.env.PORT ?? 3150);
  await application.listen(port);
}

if (import.meta.main) {
  await bootstrap();
}
