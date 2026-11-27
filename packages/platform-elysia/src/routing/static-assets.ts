import { answerStaticAsset, type StaticAssetsOptions } from "@aponiajs/common";
import type { Elysia } from "elysia";

/**
 * Mounts the application's static directories on Elysia's request boundary.
 *
 * The hook runs before routing, plugins, and middleware, so a file answers
 * without an application guard or filter in front of it — the same position the
 * other platforms mount it. The path rule and the response headers are shared
 * with every platform; only opening the file is this runtime's.
 *
 * @param application - The native Elysia application.
 * @param directories - The validated static directories, in declaration order.
 *
 * @internal
 */
export function mountStaticAssets(
  application: Elysia,
  directories: readonly StaticAssetsOptions[],
): void {
  if (directories.length === 0) {
    return;
  }

  application.onRequest(async (context: { readonly request: Request }) => {
    const pathname = new URL(context.request.url).pathname;
    for (const options of directories) {
      const response = await answerStaticAsset(pathname, options, (path) => {
        const file = Bun.file(path);
        return { body: file, exists: file.exists(), lastModified: file.lastModified };
      });
      if (response !== undefined) {
        return response;
      }
    }
    return undefined;
  });
}
