#!/usr/bin/env bun

import { runCli } from "../src/index.ts";

const exitCode = await runCli(Bun.argv.slice(2));
process.exitCode = exitCode;
