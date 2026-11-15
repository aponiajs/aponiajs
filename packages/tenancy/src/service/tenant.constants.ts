import { createToken } from "@aponiajs/common";

/** The request-context token the tenant id is stored under. */
export const TENANT = createToken<string>("aponia.tenant");
