import { createToken } from "@aponiajs/common";
import type { ResolvedHttpOptions } from "./interfaces/http-service.interface.ts";

/** The resolved options the HTTP service reads. */
export const HTTP_OPTIONS = createToken<ResolvedHttpOptions>("aponia.http.options");
