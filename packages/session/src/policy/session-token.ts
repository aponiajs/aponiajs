import { createHmac, timingSafeEqual } from "node:crypto";

/** Signs a session id into the cookie value. */
export function issueSessionToken(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

/** Verifies a cookie value and answers its session id. */
export function readSessionId(token: string, secret: string): string | undefined {
  const [id, signature, ...rest] = token.split(".");
  if (id === undefined || signature === undefined || rest.length > 0) {
    return undefined;
  }
  const expected = sign(id, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
    ? id
    : undefined;
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex");
}
