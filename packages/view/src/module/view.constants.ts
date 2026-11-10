import { createToken, type InjectionToken } from "@aponiajs/common";
import type { ViewEngine } from "./view.types.ts";

/** The injection token under which the active ViewEngine is provided. */
export const VIEW_ENGINE: InjectionToken<ViewEngine> = createToken<ViewEngine>("AponiaViewEngine");
