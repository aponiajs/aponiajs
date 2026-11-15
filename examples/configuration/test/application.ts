import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/**
 * Every environment variable the example's declaration reads.
 *
 * The suite owns this list rather than each case: `createApplication` clears all
 * of them before applying what its caller chose, so a key a case omits is
 * genuinely absent instead of whatever the machine exported. A key added to
 * `src/config.ts` belongs here too.
 */
const configurationKeys = ["PORT", "SERVICE_NAME"] as const;

/**
 * Boots the example against an environment the test chooses.
 *
 * The application validates the process environment, which is the point of the
 * example and the reason a test cannot use it as it stands: the suite would then
 * assert the machine it runs on. Every key this touches is saved and restored,
 * and the restore happens as soon as the boot has read it — a value read once at
 * boot is the claim, so nothing here needs the environment afterwards.
 */
export async function createApplication(
  env: Readonly<Record<string, string | undefined>>,
): Promise<AponiaApplication> {
  const saved = new Map<string, string | undefined>();

  for (const key of new Set([...configurationKeys, ...Object.keys(env)])) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
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

export function get(application: AponiaApplication, path: string): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`)));
}
