/** Minimal contract of a Nuxt / Nitro renderer. */
export interface NuxtRendererApp {
  render(request: Request): Promise<Response>;
}

/**
 * Creates a route handler that forwards requests to Nuxt 3 / Nitro renderer.
 *
 * @param nuxtApp - The Nuxt / Nitro renderer.
 * @returns A web Fetch handler.
 */
export function createNuxtHandler(
  nuxtApp: NuxtRendererApp,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    return nuxtApp.render(request);
  };
}
