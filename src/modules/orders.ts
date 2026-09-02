import { all, one, run, transaction } from '../database/index.js';
import { ensure, id, hash, now, transitions, audit, type Guest, type User } from './common.js';
import { orderSchema } from './schemas.js';
import { guestActive } from '../middleware/auth.js';
export function orderDetails(orderId: string): Record<string, any> | undefined {
  const order = one(
    'SELECT o.*,t.label AS table_label FROM orders o JOIN dining_tables t ON t.id=o.table_id WHERE o.id=?',
    orderId,
  );
  if (!order) return;
  return {
    ...order,
    items: all('SELECT * FROM order_items WHERE order_id=?', orderId).map((i) => ({
      ...i,
      modifiers: JSON.parse(i.modifiers),
    })),
    events: all(
      'SELECT status,created_at FROM order_events WHERE order_id=? ORDER BY created_at,rowid',
      orderId,
    ),
  };
}
export function createOrder(guest: Guest, body: unknown, key: string) {
  const input = orderSchema.parse(body);
  ensure(/^[a-zA-Z0-9-]{16,80}$/.test(key), 400, 'A valid Idempotency-Key is required.');
  const digest = hash(JSON.stringify(input));
  return transaction(() => {
    const previous = one(
      'SELECT id,request_hash FROM orders WHERE guest_id=? AND idempotency_key=?',
      guest.id,
      key,
    );
    if (previous) {
      ensure(previous.request_hash === digest, 409, 'This retry key belongs to a different order.');
      return { order: orderDetails(previous.id), replayed: true };
    }
    ensure(guestActive(guest), 410, 'This table link has changed. Please scan the QR again.');
    const active = one(
      "SELECT COUNT(*) AS count FROM orders WHERE guest_id=? AND status NOT IN ('SERVED','CANCELLED')",
      guest.id,
    );
    ensure(active!.count < 5, 429, 'Please ask your waiter before adding more active orders.');
    const lines = input.items.map((line) => {
      const item = one(
        'SELECT * FROM menu_items WHERE id=? AND branch_id=?',
        line.id,
        guest.branch_id,
      );
      ensure(
        item && item.available,
        409,
        'An item is no longer available. Please refresh the menu.',
      );
      const options = JSON.parse(item.modifiers) as { id: string; name: string; price: number }[];
      ensure(
        new Set(line.modifiers).size === line.modifiers.length,
        400,
        'Duplicate add-ons are not allowed.',
      );
      const selected = line.modifiers.map((modifier) => {
        const option = options.find((o) => o.id === modifier);
        ensure(option, 400, 'An add-on is no longer available.');
        return option;
      });
      const extras = selected.reduce((sum, m) => sum + m.price, 0);
      return {
        ...line,
        name: item.name,
        unit_price: item.price,
        modifiers: selected,
        line_total: (item.price + extras) * line.quantity,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.line_total, 0);
    ensure(Number.isSafeInteger(total) && total <= 100000000, 400, 'Order total is too large.');
    ensure(
      total === input.expected_total,
      409,
      'Prices have changed. Refresh the menu and review your basket before ordering.',
    );
    const orderId = id(),
      timestamp = now();
    const number = one('SELECT COALESCE(MAX(number),1000)+1 AS number FROM orders')!.number;
    run(
      'INSERT INTO orders(id,number,branch_id,table_id,guest_id,status,total,notes,idempotency_key,request_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      orderId,
      number,
      guest.branch_id,
      guest.table_id,
      guest.id,
      'NEW',
      total,
      input.notes,
      key,
      digest,
      timestamp,
      timestamp,
    );
    for (const line of lines)
      run(
        'INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?)',
        id(),
        orderId,
        line.id,
        line.name,
        line.unit_price,
        line.quantity,
        JSON.stringify(line.modifiers),
        line.line_total,
        line.notes,
      );
    run('INSERT INTO order_events VALUES(?,?,?,?,?)', id(), orderId, 'NEW', null, timestamp);
    return { order: orderDetails(orderId), replayed: false };
  });
}
export function transitionOrder(orderId: string, branchId: string, user: User, target: string) {
  return transaction(() => {
    const order = one('SELECT * FROM orders WHERE id=? AND branch_id=?', orderId, branchId);
    ensure(order, 404, 'Order not found.');
    ensure(
      transitions[order.status]?.includes(target),
      409,
      'The order has changed. Refresh before continuing.',
    );
    if (user.role === 'KITCHEN')
      ensure(
        ['ACCEPTED', 'PREPARING', 'READY'].includes(target),
        403,
        'Kitchen staff cannot perform this action.',
      );
    if (user.role === 'WAITER')
      ensure(target === 'SERVED', 403, 'Waiters can mark ready orders as served.');
    ensure(
      !(target === 'CANCELLED' && order.payment_status === 'PAID'),
      409,
      'Resolve the recorded payment before cancellation.',
    );
    const timestamp = now();
    run('UPDATE orders SET status=?,updated_at=? WHERE id=?', target, timestamp, orderId);
    run('INSERT INTO order_events VALUES(?,?,?,?,?)', id(), orderId, target, user.id, timestamp);
    audit(user.id, branchId, `order.${target.toLowerCase()}`, orderId);
    return orderDetails(orderId);
  });
}
