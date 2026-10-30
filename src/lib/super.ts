import { config } from '../config.js';
import { pool } from '../db/pool.js';

/** Super accounts (SUPER_EMAILS) count only once the user has proven they own the address. */
export const isSuper = (u: { email: string; email_verified: boolean }) =>
  u.email_verified && config.superEmails.includes(u.email.toLowerCase());

/**
 * Gives verified SUPER_EMAILS and ADMIN_EMAILS accounts the admin role. Typing an address at signup
 * is not enough: this runs on every sign-in and email verification (and for all users at startup),
 * and only matches users whose email is verified.
 */
export async function applyAdminRole(userId?: string) {
  await pool.query(
    `UPDATE users SET role='admin' WHERE email_verified AND email = ANY($1::text[]) AND role <> 'admin' AND ($2::uuid IS NULL OR id=$2)`,
    [[...config.superEmails, ...config.adminEmails], userId ?? null]);
}
