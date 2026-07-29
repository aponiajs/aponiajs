export type LogLevel = "fatal" | "error" | "warn" | "log" | "debug" | "verbose";

export interface LoggerService {
  log(message: unknown, ...optionalParameters: unknown[]): void;
  fatal(message: unknown, ...optionalParameters: unknown[]): void;
  error(message: unknown, ...optionalParameters: unknown[]): void;
  warn(message: unknown, ...optionalParameters: unknown[]): void;
  debug?(message: unknown, ...optionalParameters: unknown[]): void;
  verbose?(message: unknown, ...optionalParameters: unknown[]): void;
}

export interface ConsoleLoggerOptions {
  readonly logLevels?: readonly LogLevel[];
  readonly timestamp?: boolean;
  readonly prefix?: string;
  readonly json?: boolean;
  readonly colors?: boolean;
  readonly context?: string;
  readonly compact?: boolean | number;
  readonly depth?: number;
}
