import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * The exporter one process shares.
 *
 * The SDK a registration starts is process-global, so every test file in this
 * lane passes the same processor: whichever registration starts first is the
 * one that owns the provider, and the spans the others record still reach the
 * exporter the assertions read.
 */
export const exporter = new InMemorySpanExporter();
export const processor = new SimpleSpanProcessor(exporter);
