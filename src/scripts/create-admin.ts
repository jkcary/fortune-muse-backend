/**
 * Creates an admin console account, or resets its password, and prints a new random password.
 * Run: npm run admin:create -- admin@example.com
 * The account is verified and has the admin role; it signs in at /console with email + password.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, pool } from '../db/pool.js';
import { hashPassword } from '../lib/security.js';
import { createUser } from '../modules/auth/routes.js';

const email = z.string().trim().toLowerCase().email().parse(process.argv[2]);
// 18 random bytes → 24 URL-safe characters.
const password = randomBytes(18).toString('base64url');
const passwordHash = await hashPassword(password);

const existing = await one<{ id: string }>(pool, 'SELECT id FROM users WHERE email=$1', [email]);
const id = existing?.id ?? (await createUser({ email, passwordHash, country: 'US', emailVerified: true })).id;
await pool.query(`UPDATE users SET password_hash=$2, email_verified=true, role='admin', status='active' WHERE id=$1`, [id, passwordHash]);
await pool.end();

console.log(`${existing ? 'Reset' : 'Created'} admin account`);
console.log(`Email:    ${email}`);
console.log(`Password: ${password}`);
