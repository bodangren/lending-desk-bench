import { cookies, headers } from "next/headers";
import type { StaffSession } from "@/src/db/schema";

/** The staff key. API clients send it as a header, browsers as a cookie. */
export const STAFF_KEY = "staff-key-7f3a";
export const STAFF_HEADER = "x-staff-key";
export const STAFF_COOKIE = "staff_key";

/**
 * Returns the current staff session, or null when the caller is not staff.
 * Accepts either the `x-staff-key` request header or the `staff_key` cookie.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const key = h.get(STAFF_HEADER) ?? c.get(STAFF_COOKIE)?.value;
  if (key !== STAFF_KEY) return null;
  return { staffId: "stf-001", name: "Desk Staff" };
}
