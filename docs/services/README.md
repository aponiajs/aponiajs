# Services

Opt-in service packages an application registers in its module graph. Read this
category when adding authentication, tenancy, persistence, messaging,
observability, or a served protocol. Each page states the contract the package
enforces and the store or transport the application still owns.

## When to read what

| Page                                          | Answers                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| [Authentication and authorization](./auth.md) | Bearer JWT, OIDC discovery, refresh rotation, revocation, and guards      |
| [Audit events](./audit.md)                    | Bounded, redacting audit events and the store contract                    |
| [Multi-tenancy](./tenancy.md)                 | Request-scoped tenant resolution, the guard, and the identifier policy    |
| [Jobs and the outbox](./queues.md)            | In-process jobs, retries, dead letters, and the transactional outbox      |
| [Database](./database.md)                     | The Drizzle boundary, repositories, and ordered SQL migrations            |
| [Metrics](./metrics.md)                       | The Prometheus registry, request instrumentation, and the scrape endpoint |
| [Microservices](./microservices.md)           | Message patterns, CBOR client and server, and optional broker adapters    |
| [Model Context Protocol (MCP)](./mcp.md)      | Endpoint policy, the official SDK server, and the session lifecycle       |
| [OpenAPI](./openapi.md)                       | Serving a document for an application's routes and what it reflects       |
| [Devtools](./devtools.md)                     | The opt-in API served on the application's own route table                |

## Start here

Read [Authentication and authorization](./auth.md) for the request-scoped
security model, then the page for the service being added. Every page names the
store or transport the application must supply beyond one instance.

Return to the [documentation index](../README.md).
