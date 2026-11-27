import { pluginRegistrationIssues } from "@aponiajs/testing";
import { AuthModule } from "@aponiajs/auth";
import { CacheModule } from "@aponiajs/cache";
import { CompressionModule } from "@aponiajs/compression";
import { CorsModule } from "@aponiajs/cors";
import { CronModule } from "@aponiajs/cron";
import { DatabaseModule } from "@aponiajs/database";
import { DevtoolsModule } from "@aponiajs/devtools";
import { EventEmitterModule } from "@aponiajs/events";
import { GraphQLModule } from "@aponiajs/graphql";
import { HttpModule } from "@aponiajs/http";
import { McpModule } from "@aponiajs/mcp";
import { MicroserviceClientsModule } from "@aponiajs/microservices";
import { OpenApiModule } from "@aponiajs/openapi";
import { QueueModule } from "@aponiajs/queue";
import { RateLimitModule } from "@aponiajs/rate-limit";
import { SecurityModule } from "@aponiajs/security";
import { SessionModule } from "@aponiajs/session";
import { ViewModule } from "@aponiajs/view";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

/** The documented exceptions; each package guide states why. */
const synchronousOnly = new Set([
  "AuthModule",
  "CorsModule",
  "CronModule",
  "DevtoolsModule",
  "EventEmitterModule",
  "GraphQLModule",
  "OpenApiModule",
]);

const registrations = {
  AuthModule,
  CacheModule,
  CompressionModule,
  CorsModule,
  CronModule,
  DatabaseModule,
  DevtoolsModule,
  EventEmitterModule,
  GraphQLModule,
  HttpModule,
  McpModule,
  MicroserviceClientsModule,
  OpenApiModule,
  QueueModule,
  RateLimitModule,
  SecurityModule,
  SessionModule,
  ViewModule,
};

test("every plugin module exposes the registration standard", () => {
  const issues = Object.entries(registrations).flatMap(([name, moduleClass]) =>
    pluginRegistrationIssues(moduleClass, { asynchronous: !synchronousOnly.has(name) }).map(
      (member: string) => `${name}: ${member}`,
    ),
  );

  expect(issues).toEqual([]);
});
