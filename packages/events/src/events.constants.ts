/**
 * The token the one options value an event-emitter registration provides is
 * injected under.
 *
 * `@nestjs/event-emitter` publishes the same symbol token. This package's
 * registration takes no options in this release, so the value is an empty frozen
 * object; the token exists so a consumer can override or read the registration's
 * options exactly as it does with the official package.
 */
export const EVENT_EMITTER_MODULE_OPTIONS = Symbol.for("EVENT_EMITTER_MODULE_OPTIONS");
