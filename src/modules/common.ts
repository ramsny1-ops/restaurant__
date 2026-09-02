import {
  randomBytes,
  createHash,
  randomUUID,
  scrypt as rawScrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { run } from '../database/index.js';
const scrypt = promisify(rawScrypt);
export const id = () => randomUUID();
export const secret = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordVerify(password: string, stored: string) {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(digest, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function audit(actor: string, branch: string | null, action: string, entity: string) {
  run('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)', id(), actor, branch, action, entity, now());
}
export const transitions: Record<string, string[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELLED: [],
};
export type User = {
  id: string;
  business_id: string | null;
  branch_id: string | null;
  name: string;
  email: string;
  role: string;
  csrf: string;
};
export type Guest = {
  id: string;
  branch_id: string;
  table_id: string;
  qr_id: string;
  csrf: string;
  expires: number;
};
