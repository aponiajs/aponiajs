import { Body, Controller, Get, Inject, Post, UseGuards } from "@aponiajs/common";
import { AuthGuard, PermissionsGuard, Roles, RolesGuard } from "@aponiajs/auth";
import { z } from "zod";
import { UsersService } from "./users.service.ts";
import type { AuditRecord, PublicUser } from "./users.types.ts";

const CreateUser = z.object({
  email: z.email(),
  name: z.string().min(1),
  password: z.string().min(8),
  roles: z.array(z.string().min(1)).optional(),
});

/** The administrator surface: list users, create one, read the audit trail. */
@Controller("users")
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Roles("admin")
  @Get()
  list(): Promise<readonly PublicUser[]> {
    return this.users.list();
  }

  @Roles("admin")
  @Post({ body: CreateUser })
  create(@Body() body: z.infer<typeof CreateUser>): Promise<PublicUser> {
    return this.users.create(body);
  }

  @Roles("admin")
  @Get("audit")
  audit(): readonly AuditRecord[] {
    return this.users.auditRecords();
  }
}

/** The one route anyone can read, beside the login form that mints a token. */
@Controller("public")
export class PublicController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get("ping")
  ping(): { service: string } {
    return { service: this.users.serviceName };
  }
}
