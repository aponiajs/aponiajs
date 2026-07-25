# @aponiajs/cli

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli)](https://www.npmjs.com/package/@aponiajs/cli)

The Bun-native Aponia command-line interface.

## Install

```bash
bun add --global @aponiajs/cli
```

## Commands

```bash
aponia new my-api
aponia n my-api --dry-run
aponia new my-api --skip-install
aponia generate controller users
aponia g s users
aponia g resource users --type rest
aponia g router health --no-spec
aponia --version
```

The generate command supports the complete built-in Nest schematic catalog:
application, library, class, controller, decorator, filter, gateway, guard,
interface, interceptor, middleware, module, pipe, provider, resolver, resource,
and service. Nest aliases are supported, and `router`, `routers`, and `route`
map to Aponia controllers.

Generated controllers, providers, services, modules, and resources are
registered in the nearest Aponia module unless `--skip-import` is used.
Resource transports include REST, GraphQL code-first, GraphQL schema-first,
microservices, and WebSockets.

The separately published
[`create-aponia`](https://www.npmjs.com/package/create-aponia) package delegates
to the same generator. The documented CLI workflow uses the globally installed
`aponia` command consistently.

[npm package](https://www.npmjs.com/package/@aponiajs/cli) ·
[complete CLI guide](../../docs/cli.md) ·
[complete package catalog](../../docs/packages.md)
