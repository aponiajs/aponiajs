import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

/** The configuration the reference application validates once at boot. */
export const AppConfig = defineConfiguration(
  z
    .object({
      PORT: z.coerce.number().int().positive().default(3130),
      SERVICE_NAME: z.string().min(1).default("aponia-reference"),
    })
    .transform(({ PORT, SERVICE_NAME }) => ({ port: PORT, serviceName: SERVICE_NAME })),
  "reference.config",
);
