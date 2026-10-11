import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

function rounds(): number {
  const raw = process.env.BCRYPT_ROUNDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 4 && parsed <= 15 ? parsed : 11;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, rounds());
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographically strong random password containing uppercase,
 * lowercase, numbers, and special characters.
 */
export function generateSecurePassword(length = 32): string {
  const effectiveLength = Math.max(length, 24);
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude easily confused chars
  const lowers = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const specials = "!@#$%^&*()-_=+[]{}";
  const all = uppers + lowers + digits + specials;

  // Guarantee at least one character from each set
  const chars = [
    uppers[randomInt(uppers.length)],
    lowers[randomInt(lowers.length)],
    digits[randomInt(digits.length)],
    specials[randomInt(specials.length)],
  ];

  while (chars.length < effectiveLength) {
    chars.push(all[randomInt(all.length)]);
  }

  // Fisher-Yates shuffle with crypto.randomInt
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join("");
}

