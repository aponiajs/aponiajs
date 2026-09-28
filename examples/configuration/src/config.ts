import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

/**
 * The application's configuration, declared once.
 *
 * The keys are the environment's variable names, so `PORT` is what a `.env` file
 * defines and what a deployment sets. The transform is what gives the application
 * the name it reads — `port` — and it is also where the coercion lands: `PORT`
 * arrives as a string, so `PORT=abc` fails the boot instead of reaching `listen`
 * as `NaN`.
 */
export const AppConfig = defineConfiguration(
  z
    .object({
      PORT: z.coerce.number().int().positive().default(3100),
      SERVICE_NAME: z.string().min(1).default("aponia-example-configuration"),
    })
    .transform(({ PORT, SERVICE_NAME }) => ({ port: PORT, serviceName: SERVICE_NAME })),
  "app.config",
);
