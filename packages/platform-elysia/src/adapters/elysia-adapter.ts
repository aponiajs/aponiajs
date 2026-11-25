import type {
  AponiaHttpApplicationOptions,
  AponiaRootModule,
  ApplicationAdapter,
} from "@aponiajs/platform-core";
import type { AnyElysia } from "elysia";
import { AponiaFactory } from "../application/aponia.factory.ts";

/**
 * The Elysia binding the unified factory accepts.
 *
 * Elysia keeps its native executor — plugins, `HandlerContext`, and Eden types
 * — so the adapter hands the root to this platform's own factory rather than
 * lowering it into the shared kernel. The application it returns implements the
 * same surface as every other platform.
 *
 * @returns The adapter.
 */
export function elysiaAdapter(): ApplicationAdapter<AnyElysia> {
  return Object.freeze({
    kind: "application",
    name: "elysia",
    capabilities: Object.freeze([
      "http",
      "websockets",
      "streaming",
      "multipart",
      "backgroundWork",
    ] as const),
    create: (rootModule: AponiaRootModule, options?: AponiaHttpApplicationOptions) =>
      AponiaFactory.create(rootModule, options),
  });
}
