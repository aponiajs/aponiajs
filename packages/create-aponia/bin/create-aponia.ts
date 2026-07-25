#!/usr/bin/env bun

import { runCli } from "@aponiajs/cli";

const exitCode = await runCli(["new", ...Bun.argv.slice(2)]);
process.exitCode = exitCode;
