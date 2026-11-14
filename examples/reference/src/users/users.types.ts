/** The user shape the API answers; the password hash never leaves the service. */
export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
}

/** One audit record the queued job writes. */
export interface AuditRecord {
  readonly type: string;
  readonly userId: string;
  readonly at: number;
}
