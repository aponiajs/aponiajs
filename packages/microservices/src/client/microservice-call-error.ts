/** The failure one client call reports to its caller. */
export class MicroserviceCallError extends Error {
  /** The stable code the application's dispatcher or this client answered with. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MicroserviceCallError";
    this.code = code;
  }
}
