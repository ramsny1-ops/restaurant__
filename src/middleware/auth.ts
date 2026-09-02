import type { Request, Response, NextFunction } from 'express';
import { one, all, run } from '../database/index.js';
import { config } from '../config/index.js';
import { ensure, hash, secret, id, type User, type Guest } from '../modules/common.js';
export function cookie(header: string | undefined, name: string) {
  const value = header
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
  return value && /^[\w-]{40,64}$/.test(value) ? value : undefined;
}
export function getUser(header: string | undefined) {
  const token = cookie(header, 'tf_staff');
  if (!token) return;
  return one<User>(
    `SELECT u.id,u.business_id,u.branch_id,u.name,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN businesses b ON b.id=u.business_id WHERE s.token_hash=? AND s.expires>? AND u.active=1 AND (u.role='SUPER_ADMIN' OR b.active=1)`,
    hash(token),
    Date.now(),
  );
}
export function getGuest(header: string | undefined) {
  const token = cookie(header, 'tf_guest');
  if (!token) return;
  return one<Guest>(
    'SELECT * FROM guests WHERE token_hash=? AND expires>?',
    hash(token),
    Date.now(),
  );
}
export function resolveQr(token: string) {
  return one(
    `SELECT q.id,q.token,q.branch_id,q.table_id,t.label,b.name AS branch_name,b.address,v.name AS business_name FROM qr_tokens q JOIN dining_tables t ON t.id=q.table_id JOIN branches b ON b.id=q.branch_id JOIN businesses v ON v.id=b.business_id WHERE q.token=? AND q.active=1 AND t.active=1 AND v.active=1`,
    token,
  );
}
export function guestActive(guest: Guest) {
  return one(
    `SELECT g.id FROM guests g JOIN qr_tokens q ON q.id=g.qr_id JOIN dining_tables t ON t.id=g.table_id JOIN branches b ON b.id=g.branch_id JOIN businesses v ON v.id=b.business_id WHERE g.id=? AND q.active=1 AND q.table_id=g.table_id AND q.branch_id=g.branch_id AND t.active=1 AND v.active=1`,
    guest.id,
  );
}
export function setCookie(res: Response, name: string, token: string, maxAge: number) {
  res.cookie(name, token, {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}
export function ensureGuest(req: Request, res: Response, qr: Record<string, any>) {
  let guest = getGuest(req.headers.cookie);
  if (!guest || guest.qr_id !== qr.id || guest.table_id !== qr.table_id) {
    const token = secret();
    guest = {
      id: id(),
      qr_id: qr.id,
      branch_id: qr.branch_id,
      table_id: qr.table_id,
      csrf: secret(),
      expires: Date.now() + 12 * 3600000,
    };
    run(
      'INSERT INTO guests(id,token_hash,qr_id,branch_id,table_id,csrf,expires) VALUES(?,?,?,?,?,?,?)',
      guest.id,
      hash(token),
      guest.qr_id,
      guest.branch_id,
      guest.table_id,
      guest.csrf,
      guest.expires,
    );
    setCookie(res, 'tf_guest', token, 12 * 3600000);
  }
  return guest;
}
export function auth(req: Request, res: Response, next: NextFunction) {
  const user = getUser(req.headers.cookie);
  ensure(user, 401, 'Please sign in.');
  res.locals.user = user;
  next();
}
export function csrf(req: Request, res: Response, next: NextFunction) {
  const principal = res.locals.user ?? getGuest(req.headers.cookie);
  ensure(
    principal && req.get('x-csrf-token') === principal.csrf,
    403,
    'Session verification failed. Reload this page.',
  );
  next();
}
export function origin(req: Request, _res: Response, next: NextFunction) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const reqOrigin = req.get('origin');
    ensure(
      reqOrigin && config.allowedOrigins.includes(reqOrigin),
      403,
      'Request origin is not allowed.',
    );
  }
  next();
}
export function manager(_req: Request, res: Response, next: NextFunction) {
  ensure(
    ['MANAGER', 'SUPER_ADMIN'].includes(res.locals.user.role),
    403,
    'Manager access required.',
  );
  next();
}
export function platform(_req: Request, res: Response, next: NextFunction) {
  ensure(res.locals.user.role === 'SUPER_ADMIN', 403, 'Platform administrator access required.');
  next();
}
export function branchesFor(user: User) {
  return user.role === 'SUPER_ADMIN'
    ? all(
        'SELECT b.*,v.name AS business_name FROM branches b JOIN businesses v ON v.id=b.business_id WHERE v.active=1 ORDER BY v.name,b.name',
      )
    : user.role === 'MANAGER'
      ? all(
          'SELECT b.*,v.name AS business_name FROM branches b JOIN businesses v ON v.id=b.business_id WHERE b.business_id=? ORDER BY b.name',
          user.business_id,
        )
      : all(
          'SELECT b.*,v.name AS business_name FROM branches b JOIN businesses v ON v.id=b.business_id WHERE b.id=?',
          user.branch_id,
        );
}
export function scope(req: Request, res: Response, next: NextFunction) {
  const list = branchesFor(res.locals.user);
  const requested = req.get('x-branch-id') ?? req.query.branch;
  const branch = requested ? list.find((b) => b.id === requested) : list[0];
  ensure(branch, 403, 'This branch is not available to your account.');
  res.locals.branch = branch;
  next();
}
