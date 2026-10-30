import type { FastifyRequest } from 'fastify';
import { one, pool } from '../db/pool.js';
import { forbidden, unauthorized } from './errors.js';
import { verifyAccessToken } from './security.js';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
  status: 'active' | 'restricted' | 'banned';
  email_verified: boolean;
  timezone: string;
  memory_enabled: boolean;
  rooms_enabled: boolean;
  handle: string;
}

export function tokenFrom(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  // WebSocket clients in browsers cannot set headers; they pass ?token=
  const q = (req.query as Record<string, string> | undefined)?.token;
  return q ?? null;
}

export async function userFromToken(token: string | null): Promise<AuthUser | null> {
  if (!token) return null;
  let sub: string;
  try {
    sub = verifyAccessToken(token).sub;
  } catch {
    return null;
  }
  return one<AuthUser>(pool,
    'SELECT id, role, status, email_verified, timezone, memory_enabled, rooms_enabled, handle FROM users WHERE id=$1', [sub]);
}

export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  const u = await userFromToken(tokenFrom(req));
  if (!u) throw unauthorized();
  if (u.status === 'banned') throw forbidden('banned', 'This account has been suspended.');
  // A client may send its current time zone so "today" follows the user when travelling.
  const tz = req.headers['x-timezone'];
  if (typeof tz === 'string' && tz && tz !== u.timezone) u.timezone = tz;
  return u;
}

export async function requireVerified(req: FastifyRequest): Promise<AuthUser> {
  const u = await requireUser(req);
  if (!u.email_verified) throw forbidden('email_unverified', 'Please verify your email first.');
  return u;
}

export async function requireAdmin(req: FastifyRequest): Promise<AuthUser> {
  const u = await requireUser(req);
  if (u.role !== 'admin') throw forbidden();
  return u;
}
