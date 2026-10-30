import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export interface TokenClaims { sub: string; role: 'user' | 'admin' }

export function signAccessToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, { expiresIn: '30d' });
}
export function verifyAccessToken(token: string): TokenClaims {
  return jwt.verify(token, config.JWT_SECRET) as TokenClaims;
}

/** Random URL-safe token; only its hash is stored. */
export function newOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: sha256(token) };
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
