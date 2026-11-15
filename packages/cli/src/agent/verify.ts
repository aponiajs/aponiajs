/** The bounded verification scopes the MCP tool accepts. */
export type VerificationScope = "fast" | "full" | "contract";

/** One command the verifier ran. */
export interface VerificationCheck {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** The structured result one verification scope answers. */
export interface VerificationResult {
  readonly scope: VerificationScope;
  readonly ok: boolean;
  readonly checks: readonly VerificationCheck[];
}

const scopes: Readonly<Record<VerificationScope, readonly (readonly string[])[]>> = Object.freeze({
  fast: [["bun", "run", "check"]],
  full: [
    ["bun", "run", "check"],
    ["bun", "run", "test:coverage"],
    ["bun", "run", "test:vite-plus"],
  ],
  contract: [["bun", "run", "release:verify"]],
});

const timeoutByScope: Readonly<Record<VerificationScope, number>> = Object.freeze({
  fast: 120_000,
  full: 900_000,
  contract: 60_000,
});

/** Runs one allowlisted verification scope in a project root. */
export async function runVerification(
  scope: VerificationScope,
  cwd: string,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  for (const command of scopes[scope]) {
    const check = await runCommand(command, cwd, timeoutByScope[scope]);
    checks.push(check);
    if (check.exitCode !== 0 || check.timedOut) {
      break;
    }
  }

  return Object.freeze({
    scope,
    ok: checks.every((check) => check.exitCode === 0 && !check.timedOut),
    checks: Object.freeze(checks),
  });
}

async function runCommand(
  command: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<VerificationCheck> {
  const process_ = Bun.spawn({
    cmd: [...command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    process_.kill();
  }, timeoutMs);

  try {
    const exitCode = await process_.exited;
    const [stdout, stderr] = await Promise.all([
      readBounded(process_.stdout),
      readBounded(process_.stderr),
    ]);
    return Object.freeze({
      command: Object.freeze([...command]),
      exitCode: timedOut ? -1 : exitCode,
      timedOut,
      stdout,
      stderr,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<string> {
  const text = await new Response(stream).text();
  const limit = 256 * 1024;
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`;
}
