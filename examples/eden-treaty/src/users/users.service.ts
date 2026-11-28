import { Injectable } from "@aponiajs/common";
import type { CreateUserInput, User } from "../models/user.schema.ts";

@Injectable()
export class UsersService {
  readonly #users: User[] = [
    { id: 1, name: "Ada Lovelace" },
    { id: 2, name: "Grace Hopper" },
  ];

  findAll(): User[] {
    return [...this.#users];
  }

  findById(id: number): User | undefined {
    return this.#users.find((user) => user.id === id);
  }

  create(input: CreateUserInput): User {
    const user: User = {
      id: this.#users.length + 1,
      name: input.name,
    };
    this.#users.push(user);
    return user;
  }
}
