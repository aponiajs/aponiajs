# @aponiajs/http

SSRF-safe outbound HTTP for AponiaJS, with timeouts, bounded responses, redirect
re-validation, and Standard Schema response validation.

```bash
bun add @aponiajs/http@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { HttpModule } from "@aponiajs/http";

@Module({
  imports: [HttpModule.register({ baseUrl: "https://api.example.com" })],
})
export class AppModule {}
```

```ts
import { Injectable } from "@aponiajs/common";
import { HttpService } from "@aponiajs/http";

@Injectable()
export class UsersClient {
  constructor(private readonly http: HttpService) {}

  find(id: string) {
    return this.http.get<User>(`/users/${id}`);
  }
}
```

## Secure defaults

- Only `http:` and `https:` URLs are allowed.
- URLs carrying credentials are refused.
- `localhost`, `.localhost`, metadata hostnames, loopback, private,
  link-local, carrier-grade NAT, multicast, and reserved addresses are blocked.
- Every hostname is resolved before the request, and every resolved address is
  checked. A hostname that resolves to a blocked address is refused.
- The validated address is pinned for the connection, with the original
  hostname in `Host` and TLS SNI, so a second DNS answer cannot rebind the
  connection to a private address.
- Every redirect is re-validated. A redirect with a request body is not followed.
- `Host` is never supplied by the caller.
- Responses are bounded; the default is 1 MiB.
- Requests time out; the default is 10 seconds.
- Retries apply only to `GET`, `HEAD`, `OPTIONS`, `PUT`, and `DELETE`.

`allowPrivateNetworks: true` is the explicit opt-out for a trusted internal
deployment. Do not enable it for a client that accepts user-supplied URLs.

## Options

| Option                 | Default  | Meaning                                      |
| ---------------------- | -------- | -------------------------------------------- |
| `baseUrl`              | —        | Base URL for relative requests.              |
| `headers`              | `{}`     | Headers sent with every request.             |
| `timeoutMs`            | `10_000` | Request timeout.                             |
| `retries`              | `0`      | Retries for idempotent methods.              |
| `retryDelayMs`         | `100`    | Base delay between retries.                  |
| `maxResponseBytes`     | `1 MiB`  | Response body limit.                         |
| `maxRedirects`         | `3`      | Redirect limit.                              |
| `allowPrivateNetworks` | `false`  | Explicit SSRF opt-out.                       |
| `fetch`                | global   | Fetch implementation, for tests or adapters. |
| `resolveAddresses`     | DNS      | Hostname resolver, for tests or adapters.    |
| `pinResolvedAddress`   | `true`   | Connect to the validated address.            |

## Request options

`method`, `headers`, `query`, `json`, `body`, `timeoutMs`, `retries`,
`redirect` (`follow`, `error`, `manual`), `maxRedirects`, `maxResponseBytes`,
`signal`, `validator`, `throwOnError`, and `idempotencyKey`.

`idempotencyKey` sends an `Idempotency-Key` header and makes a retry safe for a
method the client does not retry by default, including `POST`. A retryable
answer that carries `Retry-After` waits for that value (seconds or an HTTP date,
capped at 30 seconds) instead of the exponential delay.

`validator` is a Standard Schema. A response that does not match it fails with
`HTTP_CLIENT_INVALID_RESPONSE`, and the error carries the issue messages without
the response body.

## Limits

- This is an outbound client, not a server or a proxy.
- DNS rebinding is closed by pinning the validated address for the connection.
  The pinning uses Bun's `tls.serverName` and `proxy: false` fetch extensions;
  a custom `fetch` must honor the `Host` header and those options, or the
  application must supply a `fetch` that pins the address itself and set
  `pinResolvedAddress: false`.
- The package retries a non-idempotent method only when the request states an
  `idempotencyKey`; it never replays a request body across a redirect, and it
  never exposes a response body on error.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Published packages](../../docs/packages.md)
- [AponiaJS architecture](../../docs/architecture-and-style.md)
- [npm](https://www.npmjs.com/package/@aponiajs/http)
