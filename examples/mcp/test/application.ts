import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Boots the example application without a listener. */
export async function createApplication(): Promise<AponiaApplication> {
  return await AponiaFactory.create(AppModule, { logger: false });
}
