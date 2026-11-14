# Reference application

A small but complete application that composes the framework the way a
production service does: validated configuration, a Drizzle-backed database, JWT
authentication with role guards, a queued audit job, Prometheus metrics, and the
health probes.

```bash
bun run example:reference
```

It listens on `PORT`, which defaults to `3130`. `JWT_SECRET` defaults to a
development secret; a real deployment sets one of at least 32 characters.

## What it shows

| Piece                                      | Where                                                           |
| ------------------------------------------ | --------------------------------------------------------------- |
| Validated configuration                    | `src/config.ts`, provided by `UsersModule`                      |
| SQL migration at boot                      | `src/infrastructure.ts`                                         |
| Typed repository over one table            | `src/users/users.service.ts`                                    |
| Login, JWT issuance, and role guards       | `src/users/auth.controller.ts`, `src/users/users.controller.ts` |
| Queued audit record and idempotent enqueue | `UsersService.create`, `UsersService.onModuleInit`              |
| Metrics and scrape endpoint                | `MetricsModule.register`, `MetricsExceptionFilter`              |
| Health probes                              | `health: true` in `src/main.ts`                                 |

## Routes

| Route                                   | Access  | What it answers                              |
| --------------------------------------- | ------- | -------------------------------------------- |
| `GET /public/ping`                      | public  | The validated service name                   |
| `GET /health/live`, `GET /health/ready` | public  | The IETF health-check document               |
| `GET /metrics`                          | public  | The Prometheus registry                      |
| `POST /auth/login`                      | public  | A 15-minute access token and the user        |
| `GET /users`                            | `admin` | Every user, without the password hash        |
| `POST /users`                           | `admin` | Creates one user and queues the audit record |
| `GET /users/audit`                      | `admin` | The records the queued handler wrote         |

The seeded administrator is `ada@example.com` with password
`correct horse battery staple`. Seeding does not increment `users_created_total`,
so the metric counts users the API created.

## Try it

```bash
TOKEN=$(curl -s localhost:3130/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse battery staple"}' \
  | jq -r .token)

curl localhost:3130/users -H "authorization: Bearer $TOKEN"
curl localhost:3130/metrics
```

## Limits

The application keeps its data in an in-memory SQLite database and its queue and
metrics in the process, so it is a reference for shape, not for durability. A
deployment swaps the database and the stores it documents as process-local.
