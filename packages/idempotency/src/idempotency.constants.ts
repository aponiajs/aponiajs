import { createToken, type InjectionToken } from "@aponiajs/common";
import type {
  IdempotencyStore,
  ResolvedIdempotencyOptions,
} from "./interfaces/idempotency-store.interface.ts";

/** Internal token carrying validated idempotency options. */
export const IDEMPOTENCY_OPTIONS: InjectionToken<ResolvedIdempotencyOptions> =
  createToken<ResolvedIdempotencyOptions>("IDEMPOTENCY_OPTIONS");

/** Injection token for the active `IdempotencyStore`. */
export const IDEMPOTENCY_STORE: InjectionToken<IdempotencyStore> =
  createToken<IdempotencyStore>("IDEMPOTENCY_STORE");
