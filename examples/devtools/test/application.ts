import { createServer } from "node:net";
import type { LoggerService } from "@aponiajs/common";
import { devtoolsPathPrefix, devtoolsPlugin } from "@aponiajs/devtools";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/**
 * A logger that records what it is given and writes nothing.
 *
 * The plugin patches the logger it is handed so `/__devtools/logs` can serve
 * those lines, and the factory writes its own bootstrap lines through the logger
 * it is handed. One object reaches both, which is the example's point, so the
 * case that asserts `/logs` is asserting on a line the boot really wrote.
 */
export interface RecordingLogger extends LoggerService {
  readonly lines: readonly string[];
}

function createRecordingLogger(): RecordingLogger {
  const lines: string[] = [];

  return {
    lines,
    log: (message: unknown) => lines.push(String(message)),
    fatal: (message: unknown) => lines.push(String(message)),
    error: (message: unknown) => lines.push(String(message)),
    warn: (message: unknown) => lines.push(String(message)),
  };
}

/** Binds the loopback socket on port `0` and reads the address it took. */
async function reservePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });

  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve an ephemeral test port.");
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

export interface DevtoolsApplication {
  readonly application: AponiaElysiaApplication;
  /** The mounted surface's base URL, prefix included. */
  readonly devtools: string;
  readonly logger: RecordingLogger;
}

export async function createApplication(enabled = true): Promise<DevtoolsApplication> {
  const applicationPort = await reservePort();
  const devtoolsPort = await reservePort();
  const logger = createRecordingLogger();

  const application = await AponiaFactory.create(AppModule, {
    logger,
    plugins: [devtoolsPlugin({ enabled, port: devtoolsPort, logger })],
  });
  await application.listen(applicationPort);

  return {
    application,
    devtools: `http://127.0.0.1:${devtoolsPort}${devtoolsPathPrefix}`,
    logger,
  };
}

export function get(application: AponiaElysiaApplication, path: string): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`)));
}

export function read<T>(url: string): Promise<T> {
  return fetch(url).then((response) => response.json() as Promise<T>);
}
