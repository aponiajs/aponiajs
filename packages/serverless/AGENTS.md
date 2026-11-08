# @aponiajs/serverless — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The gateway envelope translation: an API Gateway proxy event to a `Request`, a
`Response` back to a proxy result, and the Web Fetch binding. It owns no
application code and no Elysia dependency; `ServerlessApplication` is a
structural three-member contract.

| Domain    | Owns                                            |
| --------- | ----------------------------------------------- |
| `fetch/`  | `toFetchHandler` and `FetchHandler`             |
| `lambda/` | `createLambdaHandler` and the proxy event types |

`src/index.ts` is the only public barrel.

## Invariants

- **Both payload versions stay supported.** `version: "2.0"` selects the v2
  shape; every other event is read as v1. Never drop one to simplify the other.
- **The body is never corrupted.** A textual content type with valid UTF-8 goes
  as text; every other body is base64 with `isBase64Encoded: true`. A text type
  that fails a fatal UTF-8 decode is still base64.
- **`set-cookie` is separated.** It becomes `cookies` (v2) or
  `multiValueHeaders["set-cookie"]` (v1) and is removed from `headers`; both
  gateways drop duplicate header names.
- **A body on `GET` or `HEAD` is ignored.** Constructing a `Request` with one
  throws, and a gateway event is not a request yet.
- **The host is read case-insensitively** from headers, then v1
  `multiValueHeaders`, then `localhost`.
- **No policy is invented.** Authentication, CORS, timeouts, and graceful
  shutdown belong to the application or the gateway; this package translates
  envelopes.
- **`Buffer` is acceptable here.** The package targets AWS Lambda's Node
  runtime; the Web Fetch path never touches it.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Cover both
payload versions, multi-value headers and query strings, base64 request and
response bodies, binary responses, cookies, empty bodies, and a real Aponia
application answering through the Lambda handler.
