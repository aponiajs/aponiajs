import { inspect } from "node:util";
import { unrenderableValue } from "./log-value.ts";
import type { ConsoleLoggerOptions, LoggerService, LogLevel } from "./logger.types.ts";

const logLevelOrder: readonly LogLevel[] = ["fatal", "error", "warn", "log", "debug", "verbose"];

const colorByLevel: Readonly<Record<LogLevel, number>> = {
  fatal: 31,
  error: 31,
  warn: 33,
  log: 32,
  debug: 35,
  verbose: 36,
};

export class ConsoleLogger implements LoggerService {
  static lastTimestampAt: number | undefined;

  readonly #options: Required<
    Pick<ConsoleLoggerOptions, "colors" | "json" | "prefix" | "timestamp">
  > &
    ConsoleLoggerOptions;
  readonly #originalContext: string;
  #context: string;

  constructor();
  constructor(context: string, options?: ConsoleLoggerOptions);
  constructor(options: ConsoleLoggerOptions);
  constructor(
    contextOrOptions: string | ConsoleLoggerOptions = {},
    options: ConsoleLoggerOptions = {},
  ) {
    const context =
      typeof contextOrOptions === "string" ? contextOrOptions : contextOrOptions.context;
    const suppliedOptions = typeof contextOrOptions === "string" ? options : contextOrOptions;
    const json = suppliedOptions.json ?? false;

    this.#context = context ?? "";
    this.#originalContext = this.#context;
    this.#options = {
      ...suppliedOptions,
      colors: suppliedOptions.colors ?? !json,
      json,
      prefix: suppliedOptions.prefix ?? "Aponia",
      timestamp: suppliedOptions.timestamp ?? false,
    };
  }

  setContext(context: string): void {
    this.#context = context;
  }

  resetContext(): void {
    this.#context = this.#originalContext;
  }

  isLevelEnabled(level: LogLevel): boolean {
    const configured = this.#options.logLevels;
    if (!configured) {
      return true;
    }
    if (configured.length === 0) {
      return false;
    }

    const maximumLevel = Math.max(...configured.map((item) => logLevelOrder.indexOf(item)));
    return logLevelOrder.indexOf(level) <= maximumLevel;
  }

  log(message: unknown, ...optionalParameters: unknown[]): void {
    this.#print("log", message, optionalParameters);
  }

  fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.#print("fatal", message, optionalParameters);
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    this.#print("error", message, optionalParameters);
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.#print("warn", message, optionalParameters);
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.#print("debug", message, optionalParameters);
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.#print("verbose", message, optionalParameters);
  }

  #print(level: LogLevel, message: unknown, optionalParameters: readonly unknown[]): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const context =
      typeof optionalParameters.at(-1) === "string"
        ? (optionalParameters.at(-1) as string)
        : this.#context;
    const timestamp = Date.now();
    const timestampDifference = this.#timestampDifference(timestamp);
    const output = this.#options.json
      ? this.#formatJson(level, message, context, timestamp)
      : this.#formatText(level, message, context, timestampDifference);

    process[level === "error" || level === "fatal" ? "stderr" : "stdout"].write(`${output}\n`);
  }

  /**
   * One JSON line, or a line that states the value could not be serialized.
   *
   * `JSON.stringify` refuses two shapes an application logs in the ordinary
   * course of things: an object that refers to itself — any parent and child
   * that point at each other — and one carrying a `BigInt`, which is what a
   * database identifier is. The fallback is a real line with the literal in the
   * `message` field rather than no line at all, because a consumer parsing the
   * stream cannot tell a message that was dropped from one the caller never
   * passed. It cannot refuse in turn: every field it carries is a primitive this
   * logger read from its own configuration.
   */
  #formatJson(level: LogLevel, message: unknown, context: string, timestamp: number): string {
    const record = { level, pid: process.pid, timestamp, message, ...(context ? { context } : {}) };

    try {
      return JSON.stringify(record);
    } catch {
      return JSON.stringify({ ...record, message: unrenderableValue });
    }
  }

  #formatText(
    level: LogLevel,
    message: unknown,
    context: string,
    timestampDifference: string,
  ): string {
    const prefix = this.#colorize(`[${this.#options.prefix}] ${process.pid} -`, level);
    const date = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(Date.now());
    const formattedLevel = this.#colorize(level.toUpperCase().padStart(7, " "), level);
    const formattedContext = context ? `${this.#ansi(`[${context}]`, 33)} ` : "";
    const formattedMessage = this.#colorize(this.#stringify(message), level);
    const formattedDifference = timestampDifference
      ? this.#ansi(timestampDifference, 33)
      : timestampDifference;

    return `${prefix} ${date} ${formattedLevel} ${formattedContext}${formattedMessage}${formattedDifference}`;
  }

  #timestampDifference(timestamp: number): string {
    const previousTimestamp = ConsoleLogger.lastTimestampAt;
    ConsoleLogger.lastTimestampAt = timestamp;
    return previousTimestamp && this.#options.timestamp
      ? ` +${timestamp - previousTimestamp}ms`
      : "";
  }

  /**
   * The text this logger states a value as, or the literal when the value
   * refuses every read.
   *
   * The whole body is inside one `try` rather than a guard per read: a function's
   * `name` can be a getter that throws, and `inspect` runs whatever the value
   * declared for itself, so the branch that was noticed first is not the only one
   * that can refuse. One guard makes "this cannot throw" true by construction
   * instead of true for the shapes somebody thought of.
   */
  #stringify(message: unknown): string {
    try {
      if (typeof message === "string") {
        return message;
      }
      if (typeof message === "function") {
        return message.name || message.toString();
      }

      return inspect(message, {
        colors: this.#options.colors,
        compact: this.#options.compact ?? true,
        depth: this.#options.depth ?? 5,
        breakLength: Number.POSITIVE_INFINITY,
      });
    } catch {
      return unrenderableValue;
    }
  }

  #colorize(message: string, level: LogLevel): string {
    return this.#ansi(message, colorByLevel[level]);
  }

  #ansi(message: string, color: number): string {
    return this.#options.colors ? `\u001B[${color}m${message}\u001B[0m` : message;
  }
}

export class Logger extends ConsoleLogger {}
