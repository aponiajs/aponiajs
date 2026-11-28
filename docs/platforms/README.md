# Platforms

The HTTP runtime an application boots on and the interfaces that runtime exposes:
native plugins, WebSocket gateways, Eden Treaty types, and compiled-application
inspection. Read this category before choosing a platform or reaching for a
runtime-specific escape hatch.

## When to read what

| Page                                                  | Answers                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [HTTP platforms and delivery adapters](./adapters.md) | Elysia, Hono, H3, and Nitro, and the delivery adapters that remain      |
| [Platform parity](./platform-parity.md)               | What every platform shares, the deliberate deltas, and what one refuses |
| [WebSocket gateways](./websockets.md)                 | Gateways on every platform, the message envelope, and lifecycle methods |
| [Native Elysia plugins](./native-plugins.md)          | Mounting a native plugin and typing what it adds to the context         |
| [Elysia compatibility](./elysia-compatibility.md)     | Supported Elysia versions and how a mismatch fails                      |
| [End-to-end types with Eden Treaty](./eden-treaty.md) | Native-style application types consumed through Eden Treaty             |
| [Inspecting an application](./introspection.md)       | Projecting a compiled application into frozen, serializable data        |

## Start here

Read [HTTP platforms and delivery adapters](./adapters.md), then
[platform parity](./platform-parity.md). Choose the platform before reading the
native-plugin or WebSocket page, because both describe a platform-specific
surface.

Return to the [documentation index](../README.md).
