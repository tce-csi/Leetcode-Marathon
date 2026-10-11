import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Generates an opaque, URL-safe random token. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hashes a token for at-rest storage. Tokens are high-entropy so SHA-256 is sufficient. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function randomIdempotencyKey(): string {
  return randomBytes(16).toString("hex");
}
