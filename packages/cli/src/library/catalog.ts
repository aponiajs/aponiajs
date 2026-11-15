/** The trust level a catalog entry carries. */
export type LibraryTrust = "official" | "community-reviewed" | "unverified";

/** One library entry an agent or a consumer can discover. */
export interface LibraryCatalogEntry {
  readonly name: string;
  readonly kind: "module" | "plugin" | "adapter" | "utility";
  readonly description: string;
  readonly repository: string;
  readonly docs: string;
  readonly compatibility: Readonly<{
    readonly aponia: string;
    readonly elysia: string;
    readonly bun: string;
  }>;
  readonly trust: LibraryTrust;
  readonly tags: readonly string[];
}

const compatibility = Object.freeze({
  aponia: "1.0.0-beta.26",
  elysia: "2.0.0-rc.4",
  bun: ">=1.4.4",
});

const docs = "https://github.com/aponiajs/aponiajs/blob/release/alpha/docs/packages.md";
const repository = "https://github.com/aponiajs/aponiajs";

/** The bundled catalog. It is data, not a hosted registry. */
export const libraryCatalog: readonly LibraryCatalogEntry[] = Object.freeze([
  entry("@aponiajs/audit", "module", "Bounded, redacting audit events.", ["audit", "security"]),
  entry("@aponiajs/tenancy", "module", "Request-scoped multi-tenancy and tenant guards.", [
    "tenancy",
    "multi-tenant",
  ]),
  entry("@aponiajs/auth", "plugin", "Bearer JWT authentication and authorization guards.", [
    "auth",
    "jwt",
    "rbac",
  ]),
  entry("@aponiajs/cors", "plugin", "CORS policy from a validated configuration.", [
    "http",
    "security",
  ]),
  entry("@aponiajs/cron", "plugin", "Scheduled jobs declared in a module.", ["scheduler", "jobs"]),
  entry("@aponiajs/openapi", "plugin", "An OpenAPI document for the application's routes.", [
    "openapi",
    "docs",
  ]),
  entry("@aponiajs/graphql", "plugin", "A GraphQL endpoint served in a module.", [
    "graphql",
    "api",
  ]),
  entry("@aponiajs/opentelemetry", "plugin", "Tracing for the application's own routes.", [
    "tracing",
    "observability",
  ]),
  entry("@aponiajs/cache", "module", "Bounded application caching with TTL.", [
    "cache",
    "performance",
  ]),
  entry("@aponiajs/events", "module", "Typed in-process events.", ["events", "messaging"]),
  entry("@aponiajs/http", "module", "SSRF-safe outbound HTTP.", ["http", "security"]),
  entry("@aponiajs/rate-limit", "plugin", "Fixed-window request rate limiting.", [
    "security",
    "throttle",
  ]),
  entry("@aponiajs/security", "plugin", "Security headers and signed CSRF protection.", [
    "security",
    "csrf",
  ]),
  entry("@aponiajs/session", "module", "Signed session cookies and a bounded store.", [
    "session",
    "auth",
  ]),
  entry("@aponiajs/compression", "plugin", "Brotli and gzip response compression.", [
    "compression",
    "performance",
  ]),
  entry("@aponiajs/testing", "utility", "Test application builder, overrides, and teardown.", [
    "testing",
  ]),
  entry("@aponiajs/mcp", "utility", "Model Context Protocol engine and tool registry.", [
    "agent",
    "mcp",
  ]),
  entry("@aponiajs/devtools", "plugin", "Opt-in devtools and request introspection.", [
    "devtools",
    "agent",
  ]),
]);

/** Searches the bundled catalog by name, kind, description, or tag. */
export function searchLibraries(query = ""): readonly LibraryCatalogEntry[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return libraryCatalog;
  }
  return Object.freeze(
    libraryCatalog.filter((candidate) =>
      [candidate.name, candidate.kind, candidate.description, ...candidate.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    ),
  );
}

/** Searches npm for community packages tagged `aponia-library`. */
export async function searchRemoteLibraries(
  query = "",
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<readonly LibraryCatalogEntry[]> {
  const text = ["keywords:aponia-library", query.trim()].filter(Boolean).join(" ");
  const response = await fetcher(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=50`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`npm registry search failed with status ${response.status}.`);
  }
  const body = (await response.json()) as {
    readonly objects?: readonly {
      readonly package?: {
        readonly name?: string;
        readonly description?: string;
        readonly links?: { readonly repository?: string; readonly npm?: string };
        readonly keywords?: readonly string[];
      };
    }[];
  };
  return Object.freeze(
    (body.objects ?? []).flatMap((object) => {
      const pkg = object.package;
      if (!pkg?.name) {
        return [];
      }
      const kind = pkg.keywords?.includes("adapter")
        ? "adapter"
        : pkg.keywords?.includes("plugin")
          ? "plugin"
          : pkg.keywords?.includes("utility")
            ? "utility"
            : "module";
      return [
        Object.freeze({
          name: pkg.name,
          kind,
          description: pkg.description ?? "",
          repository: pkg.links?.repository ?? pkg.links?.npm ?? "",
          docs: pkg.links?.npm ?? "",
          compatibility: Object.freeze({ aponia: "unknown", elysia: "unknown", bun: "unknown" }),
          trust: "unverified" as const,
          tags: Object.freeze(["community", "npm", ...(pkg.keywords ?? [])]),
        }),
      ];
    }),
  );
}

function entry(
  name: string,
  kind: LibraryCatalogEntry["kind"],
  description: string,
  tags: readonly string[],
): LibraryCatalogEntry {
  return Object.freeze({
    name,
    kind,
    description,
    repository,
    docs,
    compatibility,
    trust: "official",
    tags: Object.freeze([...tags]),
  });
}
