import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Every environment variable the example's configuration reads. */
const configurationKeys = ["MCP_PATH", "MCP_ALLOWED_ORIGINS", "MCP_ALLOW_UNAUTHENTICATED"] as const;

/**
 * Boots the example against an environment the suite chooses.
 *
 * The configuration validates the process environment, so each case states the
 * values it reads and the suite restores every key as soon as the boot has read
 * it. `MCP_TOKEN` is the one key read per request rather than at boot, so the
 * suite owns it for the whole file instead of per case.
 */
export async function createApplication(
  env: Readonly<Record<string, string | undefined>> = {},
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
