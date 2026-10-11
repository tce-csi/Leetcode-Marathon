import type {
  AdminUserRow,
  PublicAdmin,
  PublicStudent,
  StudentRow,
} from "./types";

export function toPublicStudent(row: StudentRow): PublicStudent {
  const {
    password_hash: _passwordHash,
    normalized_roll_number: _normalizedRoll,
    leetcode_username_normalized: _normalizedLeetcode,
    ...rest
  } = row;
  return rest;
}

export function toPublicAdmin(row: AdminUserRow): PublicAdmin {
  const { password_hash: _passwordHash, ...rest } = row;
  return rest;
}
