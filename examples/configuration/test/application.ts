import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/**
 * Boots the example against an environment the test chooses.
 *
 * The application validates the process environment, which is the point of the
 * example and the reason a test cannot use it as it stands: the suite would then
 * assert the machine it runs on. Every key is saved and restored, and the restore
 * happens as soon as the boot has read it — a value read once at boot is the
 * claim, so nothing here needs the environment afterwards.
 */
export async function createApplication(
  env: Readonly<Record<string, string | undefined>>,
): Promise<AponiaElysiaApplication> {
  const saved = new Map(Object.keys(env).map((key) => [key, process.env[key]]));

  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await AponiaFactory.create(AppModule, { logger: false });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function get(application: AponiaElysiaApplication, path: string): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`)));
}
