import { User, UserRole, UserStatus } from "../types";

/**
 * Defensively strips accidental wrapping/embedded single quotes from a DB value
 * (e.g. a column default that was mistakenly saved as "'pending'" instead of "pending").
 * This guards the app against that class of data corruption regardless of the
 * underlying cause, and is a no-op for already-clean/unexpected values.
 */
function normalizeEnumValue<T extends string>(
  value: any,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== "string") return fallback;
  const stripped = value.trim().replace(/^'+|'+$/g, "") as T;
  return allowed.includes(stripped) ? stripped : fallback;
}

const USER_ROLES: readonly UserRole[] = ["super_admin", "admin", "user"];
const USER_STATUSES: readonly UserStatus[] = ["pending", "approved", "blocked"];

/**
 * Maps a raw Supabase user_profiles row (snake_case) to our app's User type (camelCase).
 */
export function mapProfileToUser(profile: Record<string, any>): User {
  return {
    id: profile.id ?? "",
    firstName: profile.first_name ?? "",
    lastName: profile.last_name ?? "",
    email: profile.email ?? "",
    phoneNumber: profile.phone ?? profile.phone_number ?? "",
    role: normalizeEnumValue(profile.role, USER_ROLES, "user"),
    status: normalizeEnumValue(profile.status, USER_STATUSES, "pending"),
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    photo: profile.photo ?? undefined,
    counts: profile.counts ?? { christians: 0, friends: 0 },
    personalPlan: profile.personal_plan ?? null,
    disciples: Array.isArray(profile.disciples) ? profile.disciples : [],
    groups: Array.isArray(profile.user_groups) ? profile.user_groups : [],
  };
}
