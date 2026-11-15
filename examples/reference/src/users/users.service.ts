import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@aponiajs/common";
import { PasswordService } from "@aponiajs/auth";
import { DatabaseService, createRepository, type Repository } from "@aponiajs/database";
import { MetricsRegistry } from "@aponiajs/metrics";
import { QueueService } from "@aponiajs/queue";
import { eq } from "drizzle-orm";
import { AppConfig } from "../config.ts";
import { users } from "./user.schema.ts";
import type { AuditRecord, PublicUser } from "./users.types.ts";

const auditJob = "audit.user.created";

/** The validated configuration the service reads. */
interface ReferenceConfig {
  readonly port: number;
  readonly serviceName: string;
}

/** Owns the user flows, the seed data, and the queued audit record. */
@Injectable()
export class UsersService implements OnModuleInit {
  readonly #repository: Repository<typeof users>;
  readonly #queue: QueueService;
  readonly #passwords: PasswordService;
  readonly #created: ReturnType<MetricsRegistry["counter"]>;
  readonly #audit: AuditRecord[] = [];
  readonly #config: ReferenceConfig;

  constructor(
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(QueueService) queue: QueueService,
    @Inject(PasswordService) passwords: PasswordService,
    @Inject(MetricsRegistry) metrics: MetricsRegistry,
    @Inject(AppConfig) config: ReferenceConfig,
  ) {
    this.#repository = createRepository(database.client, users);
    this.#queue = queue;
    this.#passwords = passwords;
    this.#created = metrics.counter("users_created_total", {
      help: "Users the reference application created.",
    });
    this.#config = config;
  }

  /** Registers the audit handler and seeds one administrator for the example. */
  async onModuleInit(): Promise<void> {
    const audit = this.#audit;
    this.#queue.registerHandler<AuditRecord>(auditJob, (payload) => {
      audit.push(payload);
    });
    if ((await this.#findByEmail("ada@example.com")) === undefined) {
      await this.#insert({
        email: "ada@example.com",
        name: "Ada Lovelace",
        password: "correct horse battery staple",
        roles: ["admin"],
      });
    }
  }

  /** The service name the boot validated, for the ping route. */
  get serviceName(): string {
    return this.#config.serviceName;
  }

  /** The port the application reads when it starts listening. */
  get port(): number {
    return this.#config.port;
  }

  /** Every user, without the password hash. */
  async list(): Promise<readonly PublicUser[]> {
    const rows = await this.#repository.findMany();
    return Object.freeze(rows.map((row) => toPublicUser(row)));
  }

  /** Checks one email and password and answers the user it names. */
  async authenticate(email: string, password: string): Promise<PublicUser | undefined> {
    const user = await this.#findByEmail(email);
    if (user === undefined || !(await this.#passwords.verify(password, user.passwordHash))) {
      return undefined;
    }
    return toPublicUser(user);
  }

  /** Inserts one user and records the creation through the queue. */
  async create(input: {
    readonly email: string;
    readonly name: string;
    readonly password: string;
    readonly roles?: readonly string[];
  }): Promise<PublicUser> {
    const user = await this.#insert(input);
    this.#created.inc();
    this.#queue.enqueue(
      auditJob,
      { type: "user.created", userId: user.id, at: Date.now() },
      { idempotencyKey: `user-created:${user.id}` },
    );
    return user;
  }

  /** The audit records the queued handler wrote. */
  auditRecords(): readonly AuditRecord[] {
    return Object.freeze([...this.#audit]);
  }

  async #insert(input: {
    readonly email: string;
    readonly name: string;
    readonly password: string;
    readonly roles?: readonly string[];
  }): Promise<PublicUser> {
    const id = randomUUID();
    const roles = Object.freeze([...(input.roles ?? ["member"])]);
    const row = await this.#repository.insert({
      id,
      email: input.email,
      name: input.name,
      passwordHash: await this.#passwords.hash(input.password),
      roles: JSON.stringify(roles),
      createdAt: Date.now(),
    });
    return toPublicUser(row);
  }

  async #findByEmail(email: string) {
    const [row] = await this.#repository.findMany({ where: eq(users.email, email), limit: 1 });
    return row;
  }
}

function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return Object.freeze({
    id: row.id,
    email: row.email,
    name: row.name,
    roles: Object.freeze(parseRoles(row.roles)),
  });
}

function parseRoles(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((role) => typeof role === "string")
      ? parsed
      : ["member"];
  } catch {
    return ["member"];
  }
}
