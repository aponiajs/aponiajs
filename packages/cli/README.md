# @aponiajs/cli

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli)](https://www.npmjs.com/package/@aponiajs/cli)

The Bun-native Aponia command-line interface.

## Install

```bash
bun add --dev @aponiajs/cli
```

## Commands

```bash
bunx aponia new my-api
bunx aponia n my-api --dry-run
bunx aponia new my-api --skip-install
bunx aponia --version
```

The initial CLI implements the standard application generator. Component and
resource schematics will be added behind the same command architecture after
their module-registration transforms are safe and testable.

For one-command project creation, use the separately published
[`create-aponia`](https://www.npmjs.com/package/create-aponia) entrypoint:

```bash
bun create aponia my-api
```

[npm package](https://www.npmjs.com/package/@aponiajs/cli) ·
[complete CLI guide](../../docs/cli.md) ·
[complete package catalog](../../docs/packages.md)
