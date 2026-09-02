import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import QRCode from 'qrcode';
import { all, one, run, transaction } from '../database/index.js';
import {
  auth,
  csrf,
  manager,
  platform,
  scope,
  resolveQr,
  ensureGuest,
  getGuest,
  guestActive,
  setCookie,
  cookie,
} from '../middleware/auth.js';
import { ensure, id, secret, hash, now, passwordVerify, passwordHash, audit } from './common.js';
import { loginSchema, staffSchema, itemSchema, nameSchema } from './schemas.js';
import { createOrder, orderDetails, transitionOrder } from './orders.js';
import { createBusiness, createBranch } from './seed.js';
import { broadcast } from '../realtime/index.js';
import { config } from '../config/index.js';
export const api = Router();
const loginLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const guestLimit = rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
api.get('/health', (_req, res) => {
  one('SELECT 1');
  res.json({ status: 'ok', version: '1.0.0' });
});
api.post('/auth/login', loginLimit, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = one(
    "SELECT u.* FROM users u LEFT JOIN businesses b ON b.id=u.business_id WHERE u.email=? AND u.active=1 AND (u.role='SUPER_ADMIN' OR b.active=1)",
    input.email,
  );
  const valid = await passwordVerify(
    input.password,
    user?.password_hash ?? '00000000000000000000000000000000:'.concat('00'.repeat(64)),
  );
  ensure(user && valid, 401, 'Email or password is incorrect.');
  const token = secret();
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  run(
    'INSERT INTO sessions VALUES(?,?,?,?)',
    hash(token),
    user.id,
    secret(),
    Date.now() + 8 * 3600000,
  );
  setCookie(res, 'tf_staff', token, 8 * 3600000);
  res.json({
    data: { redirect: ['KITCHEN', 'WAITER'].includes(user.role) ? '/staff' : '/manager' },
  });
});
api.post('/auth/logout', auth, csrf, (req, res) => {
  const token = cookie(req.headers.cookie, 'tf_staff');
  if (token) run('DELETE FROM sessions WHERE token_hash=?', hash(token));
  res.clearCookie('tf_staff', {
    path: '/',
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict',
  });
  res.sendStatus(204);
});
api.get('/public/menu/:token', (req, res) => {
  const qr = resolveQr(req.params.token);
  ensure(qr, 404, 'This menu link is unavailable. Please ask a staff member.');
  const guest = ensureGuest(req, res, qr);
  res.json({
    data: {
      venue: qr,
      csrf: guest.csrf,
      session_id: guest.id,
      categories: all(
        'SELECT * FROM categories WHERE branch_id=? ORDER BY position,name',
        qr.branch_id,
      ),
      items: all('SELECT * FROM menu_items WHERE branch_id=? ORDER BY name', qr.branch_id).map(
        (x) => ({ ...x, modifiers: JSON.parse(x.modifiers) }),
      ),
    },
  });
});
api.post('/public/orders', guestLimit, csrf, (req, res) => {
  const guest = getGuest(req.headers.cookie);
  ensure(guest, 401, 'Please scan the table QR code again.');
  const result = createOrder(guest, req.body, req.get('idempotency-key') ?? '');
  if (!result.replayed) broadcast(guest.branch_id, 'order.changed', guest.id);
  res.status(result.replayed ? 200 : 201).json({ data: result.order, replayed: result.replayed });
});
api.get('/public/orders', (req, res) => {
  const guest = getGuest(req.headers.cookie);
  ensure(guest, 401, 'Please scan the table QR code again.');
  res.json({
    data: all(
      'SELECT id FROM orders WHERE guest_id=? ORDER BY created_at DESC LIMIT 30',
      guest.id,
    ).map((o) => orderDetails(o.id)),
  });
});
api.get('/public/orders/:id', (req, res) => {
  const guest = getGuest(req.headers.cookie);
  ensure(guest, 401, 'Please scan the table QR code again.');
  const order = orderDetails(String(req.params.id));
  ensure(order && order.guest_id === guest.id, 404, 'Order not found.');
  res.json({ data: order });
});
api.post('/public/requests', guestLimit, csrf, (req, res) => {
  const guest = getGuest(req.headers.cookie);
  ensure(guest && guestActive(guest), 401, 'Please scan the table QR again.');
  const { kind } = z.object({ kind: z.enum(['WAITER', 'BILL']) }).parse(req.body);
  const existing = one(
    "SELECT id FROM service_requests WHERE guest_id=? AND kind=? AND status='OPEN'",
    guest.id,
    kind,
  );
  if (existing) {
    res.json({ data: existing });
    return;
  }
  const requestId = id();
  run(
    'INSERT INTO service_requests VALUES(?,?,?,?,?,?,?)',
    requestId,
    guest.branch_id,
    guest.table_id,
    guest.id,
    kind,
    'OPEN',
    now(),
  );
  broadcast(guest.branch_id, 'service.changed');
  res.status(201).json({ data: { id: requestId } });
});
api.use(auth);
api.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? next() : csrf(req, res, next)));
api.get('/me', (_req, res) => res.json({ data: { user: res.locals.user } }));
api.get('/platform/businesses', platform, (_req, res) =>
  res.json({
    data: all(
      'SELECT v.*,(SELECT COUNT(*) FROM branches b WHERE b.business_id=v.id) AS branch_count FROM businesses v ORDER BY v.name',
    ),
  }),
);
api.post('/platform/businesses', platform, (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(100),
      branch_name: z.string().trim().min(1).max(100),
    })
    .parse(req.body);
  const data = createBusiness(body.name, body.branch_name);
  audit(res.locals.user.id, data.branchId, 'business.created', data.businessId);
  res.status(201).json({ data });
});
api.patch('/platform/businesses/:id', platform, (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  ensure(
    one('SELECT id FROM businesses WHERE id=?', String(req.params.id)),
    404,
    'Business not found.',
  );
  run('UPDATE businesses SET active=? WHERE id=?', Number(active), String(req.params.id));
  audit(res.locals.user.id, null, 'business.availability', String(req.params.id));
  res.sendStatus(204);
});
api.get(
  '/branches',
  (_req, res, next) => next(),
  async (req, res) => {
    const { branchesFor } = await import('../middleware/auth.js');
    res.json({ data: branchesFor(res.locals.user) });
  },
);
api.use(scope);
api.post('/branches', manager, (req, res) => {
  const { name, phone } = z
    .object({
      name: z.string().trim().min(1).max(100),
      phone: z.string().trim().max(40).optional(),
    })
    .parse(req.body);
  const branchId = transaction(() =>
    createBranch(res.locals.branch.business_id, name, phone ?? ''),
  );
  audit(res.locals.user.id, branchId, 'branch.created', branchId);
  res.status(201).json({ data: { id: branchId } });
});

api.patch('/branches/:id', manager, (req, res) => {
  const { name, phone } = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .parse(req.body);
  const branch = one(
    'SELECT id FROM branches WHERE id=? AND business_id=?',
    String(req.params.id),
    res.locals.branch.business_id,
  );
  ensure(branch, 404, 'Branch not found.');
  const result = run(
    'UPDATE branches SET name=COALESCE(?,name), phone=COALESCE(?,phone) WHERE id=?',
    name ?? null,
    phone ?? null,
    String(req.params.id),
  );
  ensure(result.changes, 1, 'Branch not found or not updated.');
  audit(res.locals.user.id, res.locals.branch.id, 'branch.updated', String(req.params.id));
  res.sendStatus(204);
});
api.get('/orders', (req, res) => {
  const closed = req.query.closed === '1';
  res.json({
    data: all(
      `SELECT id FROM orders WHERE branch_id=? ${closed ? '' : "AND status NOT IN ('SERVED','CANCELLED')"} ORDER BY created_at ${closed ? 'DESC' : 'ASC'} LIMIT 100`,
      res.locals.branch.id,
    ).map((o) => orderDetails(o.id)),
  });
});
api.patch('/orders/:id/status', (req, res) => {
  const { status } = z
    .object({ status: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']) })
    .parse(req.body);
  const order = transitionOrder(
    String(req.params.id),
    res.locals.branch.id,
    res.locals.user,
    status,
  );
  broadcast(res.locals.branch.id, 'order.changed', order!.guest_id);
  res.json({ data: order });
});
api.patch('/orders/:id/payment', manager, (req, res) => {
  const order = one(
    'SELECT * FROM orders WHERE id=? AND branch_id=?',
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(order, 404, 'Order not found.');
  ensure(order.status !== 'CANCELLED', 409, 'Cancelled orders cannot be paid.');
  transaction(() => {
    run("UPDATE orders SET payment_status='PAID',updated_at=? WHERE id=?", now(), order.id);
    audit(res.locals.user.id, res.locals.branch.id, 'payment.cash_recorded', order.id);
  });
  broadcast(res.locals.branch.id, 'order.changed', order.guest_id);
  res.sendStatus(204);
});
api.get('/requests', (_req, res) => {
  const rows = all(
    "SELECT r.*,t.label AS table_label,b.phone AS branch_phone FROM service_requests r JOIN dining_tables t ON t.id=r.table_id JOIN branches b ON b.id=r.branch_id WHERE r.branch_id=? AND r.status='OPEN' ORDER BY r.created_at",
    res.locals.branch.id,
  );
  const defaultPhone = process.env.WHATSAPP_NUMBER?.trim() ?? '';
  const data = rows.map((r) => {
    const phone = (r.branch_phone || defaultPhone || '').replace(/[^+0-9]/g, '');
    const wa_link = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(`Please%20assist%20at%20table%20${r.table_label}`)}`
      : null;
    return { ...r, wa_link };
  });
  res.json({ data });
});
api.patch('/requests/:id', (_req, res) => {
  const request = one(
    'SELECT * FROM service_requests WHERE id=? AND branch_id=?',
    String(_req.params.id),
    res.locals.branch.id,
  );
  ensure(request, 404, 'Request not found.');
  run("UPDATE service_requests SET status='DONE' WHERE id=?", request.id);
  audit(res.locals.user.id, res.locals.branch.id, 'service.completed', request.id);
  broadcast(res.locals.branch.id, 'service.changed');
  res.sendStatus(204);
});
api.use(manager);
api.get('/menu', (_req, res) =>
  res.json({
    data: {
      categories: all(
        'SELECT * FROM categories WHERE branch_id=? ORDER BY position,name',
        res.locals.branch.id,
      ),
      items: all(
        'SELECT m.*,c.name AS category_name FROM menu_items m JOIN categories c ON c.id=m.category_id WHERE m.branch_id=? ORDER BY c.position,m.name',
        res.locals.branch.id,
      ).map((i) => ({ ...i, modifiers: JSON.parse(i.modifiers) })),
    },
  }),
);
api.post('/categories', (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const categoryId = id();
  run(
    'INSERT INTO categories VALUES(?,?,?,?)',
    categoryId,
    res.locals.branch.id,
    name,
    one('SELECT COUNT(*) AS n FROM categories WHERE branch_id=?', res.locals.branch.id)!.n,
  );
  audit(res.locals.user.id, res.locals.branch.id, 'category.created', categoryId);
  broadcast(res.locals.branch.id, 'menu.changed');
  res.status(201).json({ data: { id: categoryId } });
});
api.patch('/categories/:id', (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const result = run(
    'UPDATE categories SET name=? WHERE id=? AND branch_id=?',
    name,
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(result.changes, 404, 'Category not found.');
  audit(res.locals.user.id, res.locals.branch.id, 'category.updated', String(req.params.id));
  broadcast(res.locals.branch.id, 'menu.changed');
  res.sendStatus(204);
});
api.delete('/categories/:id', (req, res) => {
  ensure(
    !one(
      'SELECT id FROM menu_items WHERE category_id=? AND branch_id=?',
      String(req.params.id),
      res.locals.branch.id,
    ),
    409,
    'Move all dishes before deleting this category.',
  );
  const result = run(
    'DELETE FROM categories WHERE id=? AND branch_id=?',
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(result.changes, 404, 'Category not found.');
  audit(res.locals.user.id, res.locals.branch.id, 'category.deleted', String(req.params.id));
  broadcast(res.locals.branch.id, 'menu.changed');
  res.sendStatus(204);
});
api.post('/menu-items', (req, res) => {
  const data = itemSchema.parse(req.body);
  ensure(
    one(
      'SELECT id FROM categories WHERE id=? AND branch_id=?',
      data.category_id,
      res.locals.branch.id,
    ),
    400,
    'Choose a category in this branch.',
  );
  const itemId = id();
  run(
    'INSERT INTO menu_items VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    itemId,
    res.locals.branch.id,
    data.category_id,
    data.name,
    data.description,
    data.price,
    Number(data.available),
    data.prep_minutes,
    data.image_url,
    data.dietary,
    JSON.stringify(data.modifiers),
  );
  audit(res.locals.user.id, res.locals.branch.id, 'item.created', itemId);
  broadcast(res.locals.branch.id, 'menu.changed');
  res.status(201).json({ data: { id: itemId } });
});
api.patch('/menu-items/:id', (req, res) => {
  const data = itemSchema.parse(req.body);
  ensure(
    one(
      'SELECT id FROM categories WHERE id=? AND branch_id=?',
      data.category_id,
      res.locals.branch.id,
    ),
    400,
    'Choose a category in this branch.',
  );
  const result = run(
    'UPDATE menu_items SET category_id=?,name=?,description=?,price=?,available=?,prep_minutes=?,image_url=?,dietary=?,modifiers=? WHERE id=? AND branch_id=?',
    data.category_id,
    data.name,
    data.description,
    data.price,
    Number(data.available),
    data.prep_minutes,
    data.image_url,
    data.dietary,
    JSON.stringify(data.modifiers),
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(result.changes, 404, 'Dish not found.');
  audit(res.locals.user.id, res.locals.branch.id, 'item.updated', String(req.params.id));
  broadcast(res.locals.branch.id, 'menu.changed');
  res.sendStatus(204);
});
api.patch('/menu-items/:id/availability', (req, res) => {
  const { available } = z.object({ available: z.boolean() }).parse(req.body);
  const result = run(
    'UPDATE menu_items SET available=? WHERE id=? AND branch_id=?',
    Number(available),
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(result.changes, 404, 'Dish not found.');
  audit(res.locals.user.id, res.locals.branch.id, 'item.availability', String(req.params.id));
  broadcast(res.locals.branch.id, 'menu.changed');
  res.sendStatus(204);
});
api.get('/tables', (_req, res) =>
  res.json({
    data: {
      tables: all(
        'SELECT * FROM dining_tables WHERE branch_id=? ORDER BY label',
        res.locals.branch.id,
      ),
      codes: all(
        'SELECT q.*,t.label FROM qr_tokens q JOIN dining_tables t ON t.id=q.table_id WHERE q.branch_id=? ORDER BY t.label',
        res.locals.branch.id,
      ).map((q) => ({ ...q, url: `${config.publicUrl}/q/${q.token}` })),
    },
  }),
);
api.post('/tables', (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const tableId = id();
  transaction(() => {
    run(
      'INSERT INTO dining_tables(id,branch_id,label) VALUES(?,?,?)',
      tableId,
      res.locals.branch.id,
      name,
    );
    run('INSERT INTO qr_tokens VALUES(?,?,?,?,1)', id(), secret(), res.locals.branch.id, tableId);
    audit(res.locals.user.id, res.locals.branch.id, 'table.created', tableId);
  });
  res.status(201).json({ data: { id: tableId } });
});
api.patch('/tables/:id', (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const result = run(
    'UPDATE dining_tables SET label=? WHERE id=? AND branch_id=?',
    name,
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(result.changes, 404, 'Table not found.');
  audit(res.locals.user.id, res.locals.branch.id, 'table.renamed', String(req.params.id));
  res.sendStatus(204);
});
api.patch('/qr-codes/:id', (req, res) => {
  const body = z.object({ active: z.boolean(), table_id: z.uuid() }).parse(req.body);
  ensure(
    one(
      'SELECT id FROM dining_tables WHERE id=? AND branch_id=?',
      body.table_id,
      res.locals.branch.id,
    ),
    404,
    'Table not found.',
  );
  const result = run(
    'UPDATE qr_tokens SET active=?,table_id=? WHERE id=? AND branch_id=?',
    Number(body.active),
    body.table_id,
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(result.changes, 404, 'QR not found.');
  audit(res.locals.user.id, res.locals.branch.id, 'qr.updated', String(req.params.id));
  broadcast(res.locals.branch.id, 'menu.changed');
  res.sendStatus(204);
});
api.get('/qr-codes/:id.svg', async (req, res) => {
  const qr = one(
    'SELECT token FROM qr_tokens WHERE id=? AND branch_id=?',
    String(req.params.id),
    res.locals.branch.id,
  );
  ensure(qr, 404, 'QR not found.');
  const svg = await QRCode.toString(`${config.publicUrl}/q/${qr.token}`, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 320,
  });
  res.type('image/svg+xml').send(svg);
});
api.get('/staff', (_req, res) =>
  res.json({
    data: all(
      "SELECT id,name,email,role,active FROM users WHERE business_id=? AND (branch_id=? OR role='MANAGER') ORDER BY name",
      res.locals.branch.business_id,
      res.locals.branch.id,
    ),
  }),
);
api.post('/staff', async (req, res) => {
  const data = staffSchema.parse(req.body);
  ensure(
    !one('SELECT id FROM users WHERE email=?', data.email),
    409,
    'This email is already registered.',
  );
  const userId = id(),
    digest = await passwordHash(data.password);
  run(
    'INSERT INTO users(id,business_id,branch_id,name,email,password_hash,role) VALUES(?,?,?,?,?,?,?)',
    userId,
    res.locals.branch.business_id,
    res.locals.branch.id,
    data.name,
    data.email,
    digest,
    data.role,
  );
  audit(res.locals.user.id, res.locals.branch.id, 'staff.created', userId);
  res.status(201).json({ data: { id: userId } });
});
api.patch('/staff/:id', (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  ensure(String(req.params.id) !== res.locals.user.id, 409, 'You cannot disable your own account.');
  const result = run(
    "UPDATE users SET active=? WHERE id=? AND business_id=? AND role!='SUPER_ADMIN'",
    Number(active),
    String(req.params.id),
    res.locals.branch.business_id,
  );
  ensure(result.changes, 404, 'Staff member not found.');
  run('DELETE FROM sessions WHERE user_id=?', String(req.params.id));
  audit(res.locals.user.id, res.locals.branch.id, 'staff.availability', String(req.params.id));
  res.sendStatus(204);
});
api.get('/reports', (_req, res) => {
  const branch = res.locals.branch.id;
  const stats = one(
    `SELECT COUNT(*) AS orders,COALESCE(SUM(CASE WHEN status!='CANCELLED' THEN total ELSE 0 END),0) AS ordered_total,COALESCE(SUM(CASE WHEN payment_status='PAID' THEN total ELSE 0 END),0) AS collected,COALESCE(SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END),0) AS cancelled FROM orders WHERE branch_id=? AND date(created_at,'+3 hours')=date('now','+3 hours')`,
    branch,
  );
  const top = all(
    `SELECT i.name,SUM(i.quantity) AS quantity,SUM(i.line_total) AS total FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.branch_id=? AND o.status!='CANCELLED' AND date(o.created_at,'+3 hours')=date('now','+3 hours') GROUP BY i.name ORDER BY quantity DESC LIMIT 5`,
    branch,
  );
  const active = one(
    "SELECT COUNT(*) AS active_orders, COALESCE(SUM(CASE WHEN status='NEW' THEN 1 ELSE 0 END),0) AS awaiting_acceptance FROM orders WHERE branch_id=? AND status NOT IN ('SERVED','CANCELLED')",
    branch,
  );
  res.json({ data: { stats: { ...stats, ...active }, top, timezone: 'Africa/Dar_es_Salaam' } });
});
api.get('/audit', (_req, res) =>
  res.json({
    data: all(
      'SELECT a.*,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.branch_id=? ORDER BY a.created_at DESC LIMIT 100',
      res.locals.branch.id,
    ),
  }),
);
