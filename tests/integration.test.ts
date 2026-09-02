import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
const temporary = mkdtempSync(join(tmpdir(), 'tableflow-test-'));
process.env.DATABASE_PATH = join(temporary, 'test.sqlite');
process.env.NODE_ENV = 'test';
process.env.PUBLIC_URL = 'http://127.0.0.1:19367';
process.env.COOKIE_SECURE = 'false';
const { app } = await import('../src/app.js');
const { db, all, one, run } = await import('../src/database/index.js');
const { createBusiness } = await import('../src/modules/seed.js');
const { id, passwordHash } = await import('../src/modules/common.js');
const { attachRealtime } = await import('../src/realtime/index.js');
const password = 'test-only-password-4926';
const digest = await passwordHash(password);
const a = createBusiness('Venue A', 'Branch A', true),
  b = createBusiness('Venue B', 'Branch B', true);
for (const [name, role, business, branch] of [
  ['admin', 'SUPER_ADMIN', null, null],
  ['manager', 'MANAGER', a.businessId, a.branchId],
  ['kitchen', 'KITCHEN', a.businessId, a.branchId],
  ['other', 'MANAGER', b.businessId, b.branchId],
] as const) {
  run(
    'INSERT INTO users(id,name,email,password_hash,role,business_id,branch_id) VALUES(?,?,?,?,?,?,?)',
    id(),
    name,
    `${name}@test.invalid`,
    digest,
    role,
    business,
    branch,
  );
}
const server = createServer(app);
const closeWs = attachRealtime(server);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = (server.address() as { port: number }).port;
const root = `http://127.0.0.1:${port}`;
const origin = 'http://127.0.0.1:19367';
class Client {
  cookie = '';
  csrf = '';
  branch = '';
  async request(path: string, method = 'GET', body?: any, headers: Record<string, string> = {}) {
    const res = await fetch(root + path, {
      method,
      headers: {
        origin,
        'Content-Type': 'application/json',
        cookie: this.cookie,
        'X-CSRF-Token': this.csrf,
        ...(this.branch ? { 'X-Branch-ID': this.branch } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, text, json };
  }
  async login(name: string) {
    const result = await this.request('/api/v1/auth/login', 'POST', {
      email: `${name}@test.invalid`,
      password,
    });
    assert.equal(result.status, 200);
    const me = await this.request('/api/v1/me');
    this.csrf = me.json.data.user.csrf;
  }
}
const manager = new Client(),
  kitchen = new Client(),
  admin = new Client(),
  other = new Client(),
  guest = new Client(),
  outsider = new Client();
const qr = one('SELECT * FROM qr_tokens WHERE branch_id=? LIMIT 1', a.branchId)!;
const dish = one(
  'SELECT * FROM menu_items WHERE branch_id=? AND name=?',
  a.branchId,
  'Charcoal chicken',
)!;
let orderId = '',
  orderKey = id();
let payload = {
  expected_total: 38000,
  items: [{ id: dish.id, quantity: 2, modifiers: ['extra-sauce'], notes: 'Mild please' }],
  notes: 'Bring water too',
};
const wsClients: WebSocket[] = [];
after(async () => {
  wsClients.forEach((ws) => ws.terminate());
  closeWs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});
await test('hospitality MVP integration', async (t) => {
  await t.test('health and rendered login are available without authentication', async () => {
    assert.equal((await guest.request('/api/v1/health')).json.status, 'ok');
    assert.match((await guest.request('/login')).text, /Welcome back/);
    assert.equal((await guest.request('/api/v1/orders')).status, 401);
  });
  await t.test('login creates private sessions and rejects bad credentials', async () => {
    assert.equal(
      (
        await guest.request('/api/v1/auth/login', 'POST', {
          email: 'manager@test.invalid',
          password: 'wrong',
        })
      ).status,
      401,
    );
    await manager.login('manager');
    await kitchen.login('kitchen');
    await admin.login('admin');
    await other.login('other');
    manager.branch = a.branchId;
    kitchen.branch = a.branchId;
    other.branch = b.branchId;
  });
  await t.test('customer menu establishes table context and a CSRF token', async () => {
    const result = await guest.request(`/api/v1/public/menu/${qr.token}`);
    assert.equal(result.status, 200);
    assert.equal(result.json.data.venue.table_id, qr.table_id);
    assert.equal(result.json.data.items.length, 10);
    guest.csrf = result.json.data.csrf;
    assert.match(guest.cookie, /tf_guest=/);
    const second = await outsider.request(`/api/v1/public/menu/${qr.token}`);
    outsider.csrf = second.json.data.csrf;
    assert.match((await guest.request(`/q/${qr.token}`)).text, /Make yourself/);
  });
  await t.test('origin and CSRF are checked on mutations', async () => {
    assert.equal(
      (
        await guest.request('/api/v1/public/orders', 'POST', payload, {
          'Idempotency-Key': orderKey,
          origin: 'https://evil.invalid',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await guest.request('/api/v1/public/orders', 'POST', payload, {
          'Idempotency-Key': orderKey,
          'X-CSRF-Token': 'bad',
        })
      ).status,
      403,
    );
  });
  await t.test('server rejects invalid modifiers and changed prices', async () => {
    assert.equal(
      (
        await guest.request(
          '/api/v1/public/orders',
          'POST',
          { ...payload, items: [{ id: dish.id, quantity: 1, modifiers: ['invented'] }] },
          { 'Idempotency-Key': id() },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await guest.request(
          '/api/v1/public/orders',
          'POST',
          { ...payload, expected_total: 1 },
          { 'Idempotency-Key': id() },
        )
      ).status,
      409,
    );
    assert.equal(one('SELECT COUNT(*) AS n FROM orders')!.n, 0);
  });
  await t.test('order creation records snapshots, totals and one initial event', async () => {
    const result = await guest.request('/api/v1/public/orders', 'POST', payload, {
      'Idempotency-Key': orderKey,
    });
    assert.equal(result.status, 201);
    orderId = result.json.data.id;
    assert.equal(result.json.data.total, 38000);
    assert.equal(result.json.data.status, 'NEW');
    assert.equal(result.json.data.items[0].unit_price, 18000);
    assert.equal(result.json.data.events.length, 1);
  });
  await t.test(
    'same retry returns the same order even after menu availability changes',
    async () => {
      run('UPDATE menu_items SET price=20000,available=0 WHERE id=?', dish.id);
      const retry = await guest.request('/api/v1/public/orders', 'POST', payload, {
        'Idempotency-Key': orderKey,
      });
      assert.equal(retry.status, 200);
      assert.equal(retry.json.data.id, orderId);
      assert.equal(retry.json.data.total, 38000);
      assert.equal(one('SELECT COUNT(*) AS n FROM orders')!.n, 1);
      const conflict = await guest.request(
        '/api/v1/public/orders',
        'POST',
        { ...payload, notes: 'different' },
        { 'Idempotency-Key': orderKey },
      );
      assert.equal(conflict.status, 409);
      assert.equal(
        (await guest.request('/api/v1/public/orders', 'POST', payload, { 'Idempotency-Key': id() }))
          .status,
        409,
      );
      run('UPDATE menu_items SET available=1 WHERE id=?', dish.id);
    },
  );
  await t.test('customers and staff cannot access another session or tenant', async () => {
    assert.equal((await outsider.request(`/api/v1/public/orders/${orderId}`)).status, 404);
    assert.deepEqual((await other.request('/api/v1/orders')).json.data, []);
    assert.equal(
      (await other.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'ACCEPTED' }))
        .status,
      404,
    );
    assert.equal(
      (await manager.request('/api/v1/orders', 'GET', undefined, { 'X-Branch-ID': b.branchId }))
        .status,
      403,
    );
    assert.equal((await kitchen.request('/api/v1/menu')).status, 403);
    assert.equal((await manager.request('/api/v1/platform/businesses')).status, 403);
  });
  await t.test('rendered management pages and real QR assets work', async () => {
    for (const path of [
      '/manager',
      '/manager/menu',
      '/manager/tables',
      '/manager/staff',
      '/manager/orders',
      '/manager/audit',
      '/staff',
    ])
      assert.equal((await manager.request(path)).status, 200, path);
    const qrAsset = await manager.request(`/api/v1/qr-codes/${qr.id}.svg`);
    assert.equal(qrAsset.status, 200);
    assert.match(qrAsset.text, /<svg/);
    const print = await manager.request(`/print/qr/${qr.id}`);
    assert.equal(print.status, 200);
    assert.match(print.text, /data:image\/png;base64/);
    assert.equal((await other.request(`/print/qr/${qr.id}`)).status, 404);
  });
  await t.test('authenticated WebSockets deliver the owner’s order update', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live?audience=customer`, {
      headers: { Cookie: guest.cookie, Origin: origin },
    });
    wsClients.push(socket);
    await once(socket, 'open');
    const update = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No live order update')), 3000);
      socket.on('message', (raw) => {
        const event = JSON.parse(String(raw));
        if (event.type === 'order.changed') {
          clearTimeout(timeout);
          resolve(event);
        }
      });
    });
    const result = await kitchen.request(`/api/v1/orders/${orderId}/status`, 'PATCH', {
      status: 'ACCEPTED',
    });
    assert.equal(result.status, 200);
    assert.equal((await update).type, 'order.changed');
    socket.close();
  });
  await t.test('the state machine rejects skipped or repeated transitions', async () => {
    assert.equal(
      (await kitchen.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'ACCEPTED' }))
        .status,
      409,
    );
    assert.equal(
      (await kitchen.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'SERVED' }))
        .status,
      409,
    );
    assert.equal(
      (await kitchen.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'PREPARING' }))
        .status,
      200,
    );
    assert.equal(
      (await kitchen.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'READY' }))
        .status,
      200,
    );
    assert.equal(
      (await kitchen.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'SERVED' }))
        .status,
      403,
    );
    assert.equal(
      (await manager.request(`/api/v1/orders/${orderId}/status`, 'PATCH', { status: 'SERVED' }))
        .status,
      200,
    );
    assert.equal(
      (await guest.request(`/api/v1/public/orders/${orderId}`)).json.data.events.length,
      5,
    );
  });
  await t.test('cash payment and reports preserve the original order value', async () => {
    assert.equal((await kitchen.request(`/api/v1/orders/${orderId}/payment`, 'PATCH')).status, 403);
    assert.equal((await manager.request(`/api/v1/orders/${orderId}/payment`, 'PATCH')).status, 204);
    const report = await manager.request('/api/v1/reports');
    assert.equal(report.json.data.stats.collected, 38000);
    assert.equal(report.json.data.top[0].quantity, 2);
  });
  await t.test('service requests deduplicate until handled', async () => {
    const first = await guest.request('/api/v1/public/requests', 'POST', { kind: 'BILL' });
    const retry = await guest.request('/api/v1/public/requests', 'POST', { kind: 'BILL' });
    assert.equal(first.json.data.id, retry.json.data.id);
    assert.equal((await manager.request('/api/v1/requests')).json.data.length, 1);
    assert.equal(
      (await manager.request(`/api/v1/requests/${first.json.data.id}`, 'PATCH')).status,
      204,
    );
    assert.equal((await manager.request('/api/v1/requests')).json.data.length, 0);
  });

  await t.test('manager menu editing checks category ownership and stores add-ons', async () => {
    const category = await manager.request('/api/v1/categories', 'POST', { name: 'Test specials' });
    assert.equal(category.status, 201);
    const item = {
      name: 'Test plate',
      category_id: category.json.data.id,
      price: 9000,
      modifiers: [{ id: 'extra', name: 'Extra rice', price: 1000 }],
    };
    const created = await manager.request('/api/v1/menu-items', 'POST', item);
    assert.equal(created.status, 201);
    assert.equal(
      (
        await manager.request(`/api/v1/menu-items/${created.json.data.id}`, 'PATCH', {
          ...item,
          price: 10000,
        })
      ).status,
      204,
    );
    const wrongCategory = one(
      'SELECT id FROM categories WHERE branch_id=? LIMIT 1',
      b.branchId,
    )!.id;
    assert.equal(
      (await manager.request('/api/v1/menu-items', 'POST', { ...item, category_id: wrongCategory }))
        .status,
      400,
    );
    assert.equal(
      (await manager.request(`/api/v1/categories/${category.json.data.id}`, 'DELETE')).status,
      409,
    );
    assert.equal(
      (
        await manager.request(`/api/v1/menu-items/${created.json.data.id}/availability`, 'PATCH', {
          available: false,
        })
      ).status,
      204,
    );
  });
  await t.test('staff creation and disabling are scoped and revoke sessions', async () => {
    const created = await manager.request('/api/v1/staff', 'POST', {
      name: 'New waiter',
      email: 'waiter@test.invalid',
      password,
      role: 'WAITER',
    });
    assert.equal(created.status, 201);
    const waiter = new Client();
    await waiter.login('waiter');
    assert.equal((await waiter.request('/api/v1/menu')).status, 403);
    assert.equal(
      (await other.request(`/api/v1/staff/${created.json.data.id}`, 'PATCH', { active: false }))
        .status,
      404,
    );
    assert.equal(
      (await manager.request(`/api/v1/staff/${created.json.data.id}`, 'PATCH', { active: false }))
        .status,
      204,
    );
    assert.equal((await waiter.request('/api/v1/orders')).status, 401);
  });
  await t.test('dynamic QR reassignment invalidates old ordering context', async () => {
    const destination = one(
      'SELECT * FROM dining_tables WHERE branch_id=? AND id!=? LIMIT 1',
      a.branchId,
      qr.table_id,
    )!;
    assert.equal(
      (
        await manager.request(`/api/v1/qr-codes/${qr.id}`, 'PATCH', {
          active: true,
          table_id: destination.id,
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await guest.request(
          '/api/v1/public/orders',
          'POST',
          { ...payload, expected_total: 42000 },
          { 'Idempotency-Key': id() },
        )
      ).status,
      410,
    );
    const rerouted = await guest.request(`/api/v1/public/menu/${qr.token}`);
    assert.equal(rerouted.json.data.venue.table_id, destination.id);
    assert.equal((await manager.request('/api/v1/tables')).json.data.tables.length, 8);
  });
  await t.test('audit logs reject updates and deletions', async () => {
    assert.ok(one('SELECT id FROM audit_logs WHERE action=?', 'order.accepted'));
    assert.throws(() => run('DELETE FROM audit_logs'), /append only/);
    assert.throws(() => run("UPDATE audit_logs SET action='hidden'"), /append only/);
  });
  await t.test('platform business creation and tenant pause are enforced', async () => {
    const created = await admin.request('/api/v1/platform/businesses', 'POST', {
      name: 'New restaurant',
      branch_name: 'New branch',
    });
    assert.equal(created.status, 201);
    assert.ok(created.json.data.businessId);
    assert.equal(
      (
        await admin.request(`/api/v1/platform/businesses/${b.businessId}`, 'PATCH', {
          active: false,
        })
      ).status,
      204,
    );
    assert.equal((await other.request('/api/v1/orders')).status, 401);
    const otherQr = one('SELECT token FROM qr_tokens WHERE branch_id=? LIMIT 1', b.branchId)!;
    assert.equal((await outsider.request(`/api/v1/public/menu/${otherQr.token}`)).status, 404);
  });
  await t.test('logout revokes the session immediately', async () => {
    assert.equal((await manager.request('/api/v1/auth/logout', 'POST')).status, 204);
    assert.equal((await manager.request('/api/v1/orders')).status, 401);
  });
});
