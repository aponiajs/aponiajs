import { createToken } from "@aponiajs/common";
import type { ResolvedHttpOptions } from "../client/http-service.types.ts";

/** The resolved options the HTTP service reads. */
export const HTTP_OPTIONS = createToken<ResolvedHttpOptions>("aponia.http.options");
