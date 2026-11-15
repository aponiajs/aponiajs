import { Logger } from "@aponiajs/common";

/**
 * The application's logger, held here because two places take the same object.
 *
 * `AponiaFactory.create` writes every bootstrap line through the logger it is
 * handed, and `devtoolsPlugin` patches the logger it is handed in place so
 * `/__devtools/logs` can serve those lines. Hand it to both or to neither: a
 * logger that reached only one of them leaves the other with nothing to record
 * or nothing to record from.
 */
export const appLogger = new Logger("Example");
