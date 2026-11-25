import { AponiaError } from "@aponiajs/common";

/** Bun-native password hashing and verification. */
export class PasswordService {
  /** Hashes a password with Bun's default password algorithm. */
  async hash(password: string): Promise<string> {
    assertPassword(password);
    return await Bun.password.hash(password);
  }

  /** Verifies a password against a stored hash. */
  async verify(password: string, hash: string): Promise<boolean> {
    assertPassword(password);
    return await Bun.password.verify(password, hash);
  }
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    throw new AponiaError("INVALID_AUTH_OPTIONS", "A password must be a non-empty string.");
  }
}
