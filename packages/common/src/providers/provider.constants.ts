/**
 * The lifetime a provider instance is kept for: singleton, request, or transient.
 */
export const Scope = {
  DEFAULT: "singleton",
  REQUEST: "request",
  TRANSIENT: "transient",
} as const;
