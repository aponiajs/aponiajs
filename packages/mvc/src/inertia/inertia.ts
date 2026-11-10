import { Serialize, type RouteContext } from "@aponiajs/common";
import { defaultInertiaRootView } from "./inertia.constants.ts";
import type { InertiaOptions, InertiaPage } from "./inertia.types.ts";

const defaultVersion = "1";

/**
 * Renders one Inertia page for React or Vue.
 *
 * An `X-Inertia` request receives the page object as JSON, which is the
 * client-side navigation path. A plain browser request receives the root
 * document with the page payload embedded in `#app`, which hydrates the same
 * component on first load.
 *
 * @param component - The front-end component name.
 * @param props - The data the component receives.
 * @param request - The request that asked for the page.
 * @param options - Root document and asset version.
 * @returns The JSON or HTML response.
 */
export function createInertiaResponse(
  component: string,
  props: Record<string, unknown>,
  request: Request,
  options: InertiaOptions = {},
): Response {
  const url = new URL(request.url);
  const version = options.version ?? defaultVersion;
  const page: InertiaPage = Object.freeze({
    component,
    props: Object.freeze({ ...props }),
    url: `${url.pathname}${url.search}`,
    version,
  });

  if (request.headers.get("x-inertia") === "true") {
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-inertia": "true",
        vary: "X-Inertia",
      },
    });
  }

  const payload = JSON.stringify(page).replace(/</g, "\\u003c");
  const root = (options.rootView ?? defaultInertiaRootView)
    .replace("{{ inertia }}", `<div id="app" data-page="${escapeAttribute(payload)}"></div>`)
    .replace(
      "{{ scripts }}",
      (options.scripts ?? [])
        .map((source) => `<script src="${escapeAttribute(source)}"></script>`)
        .join("\n"),
    )
    .replace(
      "{{ styles }}",
      (options.styles ?? [])
        .map((source) => `<link rel="stylesheet" href="${escapeAttribute(source)}" />`)
        .join("\n"),
    );

  return new Response(root, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      vary: "X-Inertia",
    },
  });
}

/**
 * Declares an Inertia page for one route handler.
 *
 * The handler's return value becomes the page props. The route answers the
 * Inertia protocol through the platform's response serializer, so the same
 * handler works on every delivery adapter.
 *
 * @param component - The front-end component name.
 * @param options - Root document and asset version.
 * @returns A method decorator recording the Inertia response.
 */
export function Inertia(component: string, options: InertiaOptions = {}): MethodDecorator {
  if (typeof component !== "string" || component.trim() === "") {
    throw new TypeError("Inertia() requires a non-empty component name.");
  }
  return Serialize((value: unknown, context: RouteContext) =>
    createInertiaResponse(
      component,
      typeof value === "object" && value !== null ? (value as Record<string, unknown>) : { value },
      context.request,
      options,
    ),
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
