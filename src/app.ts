import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { resolve } from 'node:path';
import { config } from './config/index.js';
import { api } from './modules/routes.js';
import { HttpError, ensure, id } from './modules/common.js';
import { getUser, origin, resolveQr, ensureGuest, branchesFor } from './middleware/auth.js';
import QRCode from 'qrcode';
import { one } from './database/index.js';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('view engine', 'ejs');
app.set('views', resolve('src/views'));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'https:', 'data:'],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'connect-src': ["'self'"],
        'upgrade-insecure-requests': config.production ? [] : null,
      },
    },
    strictTransportSecurity: config.production ? undefined : false,
  }),
);
app.use((req, res, next) => {
  res.locals.requestId = id();
  res.setHeader('X-Request-ID', res.locals.requestId);
  next();
});
app.use('/assets', express.static(resolve('src/public'), { maxAge: config.production ? '1h' : 0 }));
app.use(express.json({ limit: '64kb', strict: true }));
app.use(origin);
app.use(
  '/api/v1',
  (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  },
  rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }),
  api,
);
app.get('/login', (_req, res) =>
  res.render('login', { configured: !!one('SELECT id FROM users LIMIT 1') }),
);
app.get('/q/:token', (req, res) => {
  const qr = resolveQr(req.params.token);
  ensure(qr, 404, 'This QR code is unavailable. Please ask a staff member.');
  const guest = ensureGuest(req, res, qr);
  res.setHeader('Cache-Control', 'no-store');
  res.render('customer', { qr, csrf: guest.csrf });
});

app.get('/print/qr/:id', async (req, res) => {
  const user = getUser(req.headers.cookie);
  ensure(user && ['MANAGER', 'SUPER_ADMIN'].includes(user.role), 403, 'Manager access required.');
  const qr = one(
    'SELECT q.*,t.label,b.name AS branch_name,v.name AS business_name FROM qr_tokens q JOIN dining_tables t ON t.id=q.table_id JOIN branches b ON b.id=q.branch_id JOIN businesses v ON v.id=b.business_id WHERE q.id=?',
    req.params.id,
  );
  ensure(qr && branchesFor(user).some((b) => b.id === qr.branch_id), 404, 'QR code not found.');
  const url = `${config.publicUrl}/q/${qr.token}`;
  const image = await QRCode.toDataURL(url, { width: 700, margin: 3, errorCorrectionLevel: 'M' });
  res.setHeader('Cache-Control', 'no-store');
  res.render('print', { qr, url, image });
});
app.get('/', (req, res) => {
  const user = getUser(req.headers.cookie);
  res.redirect(
    !user ? '/login' : ['KITCHEN', 'WAITER'].includes(user.role) ? '/staff' : '/manager',
  );
});
app.get(['/staff', '/manager', '/manager/:section', '/platform'], (req, res) => {
  const user = getUser(req.headers.cookie);
  if (!user) {
    res.redirect('/login');
    return;
  }
  const kitchen = req.path === '/staff';
  ensure(
    kitchen || ['MANAGER', 'SUPER_ADMIN'].includes(user.role),
    403,
    'Manager access required.',
  );
  ensure(req.path !== '/platform' || user.role === 'SUPER_ADMIN', 403, 'Platform access required.');
  const branches = branchesFor(user);
  const branch = branches.find((b) => b.id === req.query.branch) ?? branches[0];
  const section =
    req.path === '/platform'
      ? 'platform'
      : kitchen
        ? 'kitchen'
        : String(req.params.section ?? 'overview');
  ensure(
    ['platform', 'kitchen', 'overview', 'menu', 'tables', 'staff', 'orders', 'audit'].includes(
      section,
    ),
    404,
    'Page not found.',
  );
  res.setHeader('Cache-Control', 'no-store');
  res.render('workspace', { user, branches, branch, section });
});
app.use((_req, _res, next) => next(new HttpError(404, 'Page not found.')));
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  let status =
    error instanceof ZodError
      ? 400
      : error instanceof HttpError
        ? error.status
        : error.type === 'entity.too.large'
          ? 413
          : error instanceof SyntaxError && 'body' in error
            ? 400
            : 500;
  let message =
    error instanceof ZodError
      ? error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
      : status === 500
        ? 'An unexpected error occurred. Please retry.'
        : error.message;
  if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) {
    status = 409;
    message = 'This value is already in use.';
  }
  if (status === 500)
    console.error(JSON.stringify({ requestId: res.locals.requestId, error: error.message }));
  if (req.path.startsWith('/api/'))
    res.status(status).json({ error: { message, requestId: res.locals.requestId } });
  else res.status(status).render('error', { status, message });
});
