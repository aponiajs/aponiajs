import { Body, Controller, Inject, Post } from "@aponiajs/common";
import { JwtService } from "@aponiajs/auth";
import { httpErrors } from "@aponiajs/platform-elysia";
import { z } from "zod";
import { newTokenId } from "../infrastructure.ts";
import { UsersService } from "./users.service.ts";
import type { PublicUser } from "./users.types.ts";

const Login = z.object({ email: z.email(), password: z.string().min(1) });

export interface LoginResponse {
  readonly token: string;
  readonly user: PublicUser;
}

/** Exchanges an email and password for a short-lived access token. */
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  @Post("login", { body: Login })
  async login(@Body() body: z.infer<typeof Login>): Promise<LoginResponse> {
    const user = await this.users.authenticate(body.email, body.password);
    if (user === undefined) {
      throw httpErrors.unauthorized("Email or password is incorrect.");
    }
    const token = await this.jwt.sign({
      sub: user.id,
      roles: user.roles,
      jti: newTokenId(),
    });
    return { token, user };
  }
}
