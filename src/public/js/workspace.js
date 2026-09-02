'use strict';
(() => {
  const $ = (id) => document.getElementById(id),
    esc = TF.escape,
    money = TF.money,
    section = document.body.dataset.section,
    role = document.body.dataset.role,
    branch = document.body.dataset.branch;
  let data = {},
    loading = false,
    filter = '',
    showClosed = false;
  const names = {
    NEW: 'New',
    ACCEPTED: 'Accepted',
    PREPARING: 'Preparing',
    READY: 'Ready',
    SERVED: 'Served',
    CANCELLED: 'Cancelled',
  };
  const pages = {
    overview: ['THE BIG PICTURE', 'A good day starts here.', 'A clear view of today’s service.'],
    kitchen: ['LIVE SERVICE', 'Kitchen board', 'Every order. Every table. Right on time.'],
    orders: ['EVERY DETAIL', 'Order history', 'Track orders, totals and payment records.'],
    menu: ['FRESH FROM YOUR KITCHEN', 'Menu studio', 'Your menu, always up to date.'],
    tables: ['THE FIRST CONNECTION', 'Tables and QR', 'One scan. A direct line to your kitchen.'],
    staff: ['BETTER TOGETHER', 'Your team', 'The people behind every great service.'],
    audit: ['A CLEAR RECORD', 'Activity log', 'Who changed what, and when.'],
    platform: ['PLATFORM ADMINISTRATION', 'Your businesses', 'Manage venues across your platform.'],
  };
  const [eyebrow, title, description] = pages[section];
  $('page-eyebrow').textContent = eyebrow;
  $('page-title').textContent = title;
  $('page-description').textContent = description;
  $('today-label').textContent = new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Dar_es_Salaam',
  }).format(new Date());
  const button = (text, action, primary = false) =>
    `<button class="button ${primary ? 'primary' : ''}" data-action="${action}">${text}</button>`;
  const empty = (title, description, action = '') =>
    `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">○</span><h3>${title}</h3><p>${description}</p>${action}</div>`;
  const badge = (status) =>
    `<span class="status ${status.toLowerCase()}">${names[status] ?? status}</span>`;
  const minutes = (date) =>
    Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  const time = (date) =>
    new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Dar_es_Salaam',
    });
  const actions = {
    overview: button('Open kitchen board', 'kitchen', true),
    kitchen: button('Refresh board', 'refresh'),
    orders: button('Export CSV', 'export'),
    menu: button('Categories', 'categories') + button('+ Add dish', 'add-dish', true),
    tables: button('+ Add table', 'add-table', true),
    staff: button('+ Add staff', 'add-staff', true),
    audit: button('Refresh', 'refresh'),
    platform: button('+ Add business', 'add-business', true),
  };
  $('page-actions').innerHTML = actions[section];
  function orderRows(orders) {
    return orders
      .map(
        (o) =>
          `<tr data-order="${o.id}" tabindex="0" role="button" aria-label="View order ${o.number}"><td><strong>#${o.number}</strong><span class="cell-sub">${time(o.created_at)}</span></td><td>${esc(o.table_label)}</td><td>${o.items.reduce((s, i) => s + i.quantity, 0)} items</td><td>${badge(o.status)}</td><td>${money(o.total)}</td><td><span class="status ${o.payment_status === 'PAID' ? 'paid' : 'unpaid'}">${o.payment_status === 'PAID' ? 'Paid' : 'Unpaid'}</span></td><td aria-hidden="true">↗</td></tr>`,
      )
      .join('');
  }
  function orderTable(orders) {
    return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Table</th><th>Items</th><th>Status</th><th>Total</th><th>Payment</th><th></th></tr></thead><tbody>${orderRows(orders)}</tbody></table></div>`;
  }
  function renderOverview() {
    const s = data.report.stats,
      active = data.orders.filter((o) => !['SERVED', 'CANCELLED'].includes(o.status));
    return `<div class="stat-grid"><article class="stat"><span>Orders today</span><strong>${s.orders}</strong><small>${s.cancelled} cancelled</small></article><article class="stat"><span>Ordered value</span><strong>${money(s.ordered_total)}</strong><small>Excludes cancelled orders</small></article><article class="stat"><span>Cash recorded</span><strong>${money(s.collected)}</strong><small>Confirmed by your manager</small></article><article class="stat"><span>In service</span><strong>${s.active_orders}</strong><small>${s.awaiting_acceptance} waiting to be accepted</small></article></div><div class="overview-grid"><section class="panel"><div class="panel-heading"><div><h2>Service right now</h2><p class="muted">Live orders from your tables</p></div><a class="text-link" href="/staff?branch=${branch}">Kitchen board ↗</a></div>${active.length ? orderTable(active.slice(0, 7)) : empty('Ready for the first order.', 'Your next table order will appear here.', button('View table QR codes', 'tables'))}</section><section class="panel"><div class="panel-heading"><div><h2>Today’s favourites</h2><p class="muted">What your guests are enjoying</p></div></div>${data.report.top.length ? `<div class="top-items">${data.report.top.map((item, i) => `<div class="top-item"><span class="rank">0${i + 1}</span><div><strong>${esc(item.name)}</strong><span>${item.quantity} ordered</span></div><strong>${money(item.total)}</strong></div>`).join('')}</div>` : empty('A fresh start.', 'Your popular dishes will appear after orders arrive.')}</section></div><div class="service-strip"><div><span class="dot"></span><strong>Keep your menu service-ready.</strong><span class="muted">A quick availability check makes all the difference.</span></div><a class="button" href="/manager/menu?branch=${branch}">Manage menu ↗</a></div>`;
  }
  function availableActions(order) {
    const map = {
      NEW: ['ACCEPTED', 'Accept order'],
      ACCEPTED: ['PREPARING', 'Start preparing'],
      PREPARING: ['READY', 'Mark ready'],
      READY: ['SERVED', 'Mark served'],
    };
    const action = map[order.status];
    if (!action) return '';
    if (
      (role === 'WAITER' && action[0] !== 'SERVED') ||
      (role === 'KITCHEN' && action[0] === 'SERVED')
    )
      return '';
    return `<button class="button primary wide" data-transition="${action[0]}" data-id="${order.id}">${action[1]} <span aria-hidden="true">→</span></button>`;
  }
  function renderKitchen() {
    const cols = [
      ['Incoming', ['NEW', 'ACCEPTED']],
      ['Preparing', ['PREPARING']],
      ['Ready to serve', ['READY']],
    ];
    return `${data.orders.length >= 100 ? '<p class="connection-note">Showing the oldest 100 active orders. Completing orders makes room for the next ones.</p>' : ''}${data.requests.length ? `<section class="request-bar"><strong>From the floor</strong>${data.requests.map((r) => `<div class="request-chip-wrap"><button class="request-chip" data-request="${r.id}"><strong>${esc(r.table_label)}</strong> ${r.kind === 'BILL' ? 'Bill requested' : 'Waiter requested'} <span>Complete ✓</span></button>${r.wa_link ? `<a class="wa-link" href="${esc(r.wa_link)}" target="_blank" rel="noopener" aria-label="Call via WhatsApp">📞</a>` : ''}</div>`).join('')}</section>` : ''}<div class="kitchen-grid">${cols
      .map(([name, statuses]) => {
        const orders = data.orders.filter((o) => statuses.includes(o.status));
        return `<section class="kitchen-column"><header><h2>${name}</h2><span class="count">${orders.length}</span></header><div class="kitchen-orders">${orders.map((order) => `<article class="ticket"><div class="ticket-header"><span class="ticket-number">#${order.number}</span><span class="ticket-age ${minutes(order.created_at) > 20 ? 'overdue' : ''}">${minutes(order.created_at)} min</span></div><div class="ticket-table"><h3>${esc(order.table_label)}</h3>${badge(order.status)}</div><div class="ticket-items">${order.items.map((item) => `<div class="ticket-item"><strong class="quantity-square">${item.quantity}</strong><div><strong>${esc(item.name)}</strong>${item.modifiers.length ? `<p>+ ${item.modifiers.map((m) => esc(m.name)).join(', ')}</p>` : ''}${item.notes ? `<p class="kitchen-note">${esc(item.notes)}</p>` : ''}</div></div>`).join('')}</div>${order.notes ? `<p class="kitchen-note full-note">${esc(order.notes)}</p>` : ''}<div class="ticket-footer"><span>${time(order.created_at)}</span><button class="text-button" data-order="${order.id}">Details ↗</button></div>${availableActions(order)}</article>`).join('') || `<div class="column-empty"><span aria-hidden="true">○</span><p>${name === 'Incoming' ? 'All caught up.' : 'No orders here yet.'}</p></div>`}</div></section>`;
      })
      .join('')}</div>`;
  }
  function renderOrders() {
    const orders = data.orders.filter((o) =>
      `${o.number} ${o.table_label} ${o.status}`.toLowerCase().includes(filter),
    );
    return `<div class="surface-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="order-search" type="search" placeholder="Search order, table or status" value="${esc(filter)}"></label><span class="muted">Latest ${data.orders.length} orders</span></div><section class="panel">${orders.length ? orderTable(orders) : empty('No orders yet.', 'Orders will appear here as your guests start ordering.')}</section>`;
  }
  function renderMenu() {
    const items = data.menu.items.filter((i) =>
      `${i.name} ${i.category_name}`.toLowerCase().includes(filter),
    );
    return `<div class="surface-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="item-search" type="search" placeholder="Find a dish or category" value="${esc(filter)}"></label><span class="muted">${data.menu.items.filter((i) => i.available).length} of ${data.menu.items.length} available</span></div><section class="panel">${items.length ? `<div class="table-wrap"><table><thead><tr><th>Dish</th><th>Category</th><th>Price</th><th>Prep time</th><th>Availability</th><th></th></tr></thead><tbody>${items.map((i) => `<tr><td><strong>${esc(i.name)}</strong><span class="cell-sub dish-description">${esc(i.description)}</span></td><td>${esc(i.category_name)}</td><td>${money(i.price)}</td><td>${i.prep_minutes} min</td><td><button class="switch ${i.available ? 'on' : ''}" role="switch" aria-checked="${!!i.available}" aria-label="Availability for ${esc(i.name)}" data-availability="${i.id}"><span></span></button><span class="availability-label">${i.available ? 'Available' : 'Sold out'}</span></td><td><button class="button compact" data-edit-dish="${i.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : empty('Your menu starts here.', 'Add a category, then your first dish.', button('Add a category', 'add-category', true))}</section>`;
  }
  function renderTables() {
    return `<div class="info-strip"><div><strong>Print once. Keep it current.</strong><span class="muted">Change a QR’s table destination without replacing the printed code.</span></div><span>${data.tables.codes.length} QR codes</span></div><div class="qr-grid">${data.tables.codes.map((q) => `<article class="qr-card"><div class="section-title"><h2>${esc(q.label)}</h2><span class="status ${q.active ? 'paid' : 'unpaid'}">${q.active ? 'Active' : 'Paused'}</span></div><a href="${esc(q.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(q.label)} menu"><img width="200" height="200" src="/api/v1/qr-codes/${q.id}.svg?branch=${branch}" alt="Scannable QR for ${esc(q.label)}"></a><p class="small-uppercase">SCAN. ORDER. ENJOY.</p><div class="button-row"><button class="button" data-print="${q.id}">Print</button><button class="button" data-edit-qr="${q.id}">Manage</button><a class="icon-button" href="${esc(q.url)}" target="_blank" rel="noopener" aria-label="Open menu">↗</a></div></article>`).join('')}</div><section class="panel table-directory"><div class="panel-heading"><h2>Table directory</h2></div><div class="table-labels">${data.tables.tables.map((t) => `<button class="button" data-rename-table="${t.id}">${esc(t.label)} <span class="muted">Edit</span></button>`).join('')}</div></section>`;
  }
  function renderStaff() {
    return `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Team member</th><th>Email</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>${data.staff.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${esc(u.role.toLowerCase())}</td><td>${u.active ? 'Active' : 'Disabled'}</td><td>${u.id !== document.body.dataset.user ? `<button class="button compact" data-toggle-staff="${u.id}" data-active="${u.active ? '0' : '1'}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${data.staff.length ? '' : empty('Build your service team.', 'Add managers, kitchen staff and waiters. Each person gets their own sign-in.')}</section><div class="role-guide"><article><h3>Manager</h3><p>Menu, tables, team, payments and reports across the business.</p></article><article><h3>Kitchen</h3><p>Accept, prepare and mark orders ready in this branch.</p></article><article><h3>Waiter</h3><p>View branch orders, serve ready dishes and handle table requests.</p></article></div>`;
  }
  function renderPlatform() {
    return `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Business</th><th>Branches</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${data.businesses.map((b) => `<tr><td><strong>${esc(b.name)}</strong></td><td>${b.branch_count}</td><td><span class="status ${b.active ? 'paid' : 'unpaid'}">${b.active ? 'Active' : 'Paused'}</span></td><td>${esc(b.created_at.slice(0, 10))}</td><td><button class="button compact" data-business="${b.id}" data-active="${b.active ? '0' : '1'}">${b.active ? 'Pause' : 'Activate'}</button></td></tr>`).join('')}</tbody></table></div></section><div class="info-strip"><p>Select a business branch in the sidebar to create its manager account and configure its menu.</p>${button('Add branch to selected business', 'add-branch')}</div>`;
  }
  function renderAudit() {
    return `<section class="panel">${data.audit.length ? `<div class="table-wrap"><table><thead><tr><th>Action</th><th>By</th><th>Time · EAT</th><th>Reference</th></tr></thead><tbody>${data.audit.map((a) => `<tr><td>${esc(a.action.replaceAll('.', ' / '))}</td><td>${esc(a.actor ?? 'Former user')}</td><td>${esc(a.created_at.slice(0, 10))} ${time(a.created_at)}</td><td><code>${esc(a.entity_id.slice(0, 8))}</code></td></tr>`).join('')}</tbody></table></div>` : empty('A clean record.', 'Your team’s changes will appear here.')}</section>`;
  }
  const renderers = {
    overview: renderOverview,
    kitchen: renderKitchen,
    orders: renderOrders,
    menu: renderMenu,
    tables: renderTables,
    staff: renderStaff,
    platform: renderPlatform,
    audit: renderAudit,
  };
  function render() {
    const focused = document.activeElement?.id,
      position = document.activeElement?.selectionStart;
    $('workspace-content').innerHTML = renderers[section]();
    if (['item-search', 'order-search'].includes(focused)) {
      const input = $(focused);
      input?.focus();
      try {
        input?.setSelectionRange(position, position);
      } catch {}
    }
  }
  async function load() {
    if (loading) return;
    loading = true;
    try {
      if (section === 'overview') {
        const [report, orders] = await Promise.all([TF.api('/reports'), TF.api('/orders')]);
        data = { report, orders };
      } else if (section === 'kitchen') {
        const [orders, requests] = await Promise.all([TF.api('/orders'), TF.api('/requests')]);
        data = { orders, requests };
      } else {
        const path = {
          orders: '/orders?closed=1',
          menu: '/menu',
          tables: '/tables',
          staff: '/staff',
          platform: '/platform/businesses',
          audit: '/audit',
        }[section];
        data[section === 'platform' ? 'businesses' : section] = await TF.api(path);
      }
      $('workspace-error').hidden = true;
      render();
      if ($('detail-dialog').open && $('detail-dialog').dataset.order)
        showOrder($('detail-dialog').dataset.order);
    } catch (error) {
      $('workspace-error').hidden = false;
      $('workspace-error').textContent = error.message;
      if (error.status === 401) location.assign('/login');
      if (!$('workspace-content').querySelector(':not(.skeleton-block)'))
        $('workspace-content').innerHTML = empty(
          'Unable to load this view.',
          'Check your connection and try again.',
          button('Retry', 'refresh'),
        );
    } finally {
      loading = false;
    }
  }
  function editor(title, body, onSubmit, submitLabel = 'Save changes') {
    $('editor-content').innerHTML =
      `<div class="modal-top"><h2>${title}</h2><button class="icon-button" data-close aria-label="Close editor">×</button></div><form id="editor-form">${body}<p id="editor-error" class="error-text" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary" type="submit">${submitLabel}</button></div></form>`;
    const form = $('editor-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      await TF.busy(button, async () => {
        try {
          await onSubmit(Object.fromEntries(new FormData(form)), form);
          $('editor-dialog').close();
          await load();
          TF.toast('Changes saved.');
        } catch (error) {
          $('editor-error').textContent = error.message;
          throw error;
        }
      });
    });
    TF.modal('editor-dialog');
  }
  function input(label, name, value = '', type = 'text', extra = '') {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  }
  function dishEditor(item) {
    if (!data.menu.categories.length) {
      TF.toast('Add a category before adding a dish.');
      simpleName('Add a category', '/categories');
      return;
    }
    editor(
      item ? 'Edit dish' : 'Add a dish',
      `${input('Dish name', 'name', item?.name ?? '', 'text', 'required maxlength="100"')}<label>Category<select name="category_id">${data.menu.categories.map((c) => `<option value="${c.id}" ${item?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>Description<textarea name="description" maxlength="600" rows="3">${esc(item?.description ?? '')}</textarea></label><div class="form-grid">${input('Price · TZS', 'price', item?.price ?? 0, 'number', 'required min="0" max="10000000" step="1"')}${input('Preparation · minutes', 'prep_minutes', item?.prep_minutes ?? 15, 'number', 'required min="1" max="180"')}</div>${input('Dietary label or allergens', 'dietary', item?.dietary ?? '', 'text', 'maxlength="150"')}${input('Dish photo URL · optional', 'image_url', item?.image_url ?? '', 'text', 'placeholder="https://…"')}<label class="checkbox-label"><input name="available" type="checkbox" ${item?.available === 0 ? '' : 'checked'}>Available to order</label><div class="section-title"><h3>Optional add-ons</h3><button type="button" class="button compact" id="add-modifier">+ Add</button></div><div id="modifier-rows">${(item?.modifiers ?? []).map((m) => modifierRow(m)).join('')}</div>`,
      async (_values, form) => {
        const values = Object.fromEntries(new FormData(form));
        const modifiers = [...form.querySelectorAll('.modifier-row')].map((row) => ({
          id: row.dataset.id,
          name: row.querySelector('[data-mod-name]').value.trim(),
          price: Number(row.querySelector('[data-mod-price]').value),
        }));
        await TF.api(item ? `/menu-items/${item.id}` : '/menu-items', {
          method: item ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...values,
            price: Number(values.price),
            prep_minutes: Number(values.prep_minutes),
            available: form.elements.available.checked,
            modifiers,
          }),
        });
      },
    );
    $('add-modifier').addEventListener('click', () => {
      if ($('modifier-rows').children.length >= 12) {
        TF.toast('Maximum 12 add-ons per dish.');
        return;
      }
      $('modifier-rows').insertAdjacentHTML(
        'beforeend',
        modifierRow({ id: TF.uuid(), name: '', price: 0 }),
      );
    });
    $('modifier-rows').addEventListener('click', (e) => {
      const button = e.target.closest('[data-remove-mod]');
      if (button) button.closest('.modifier-row').remove();
    });
  }
  function modifierRow(m) {
    return `<div class="modifier-row" data-id="${esc(m.id)}"><input data-mod-name value="${esc(m.name)}" placeholder="Add-on name" aria-label="Add-on name" required maxlength="100"><input data-mod-price type="number" value="${m.price}" min="0" max="10000000" step="1" aria-label="Add-on price in TZS" required><button type="button" class="icon-button" data-remove-mod aria-label="Remove add-on">×</button></div>`;
  }
  function simpleName(title, path, value = '', method = 'POST') {
    editor(title, input('Name', 'name', value, 'text', 'required maxlength="100"'), (values) =>
      TF.api(path, { method, body: JSON.stringify(values) }),
    );
  }
  function showCategories() {
    $('detail-dialog').dataset.order = '';
    $('detail-content').innerHTML =
      `<div class="modal-top"><h2>Your categories</h2><button class="icon-button" data-close aria-label="Close categories">×</button></div>${data.menu.categories.map((c) => `<div class="category-row"><strong>${esc(c.name)}</strong><div><button class="button compact" data-edit-category="${c.id}">Rename</button> <button class="button compact" data-delete-category="${c.id}">Delete</button></div></div>`).join('')}${button('+ Add category', 'add-category', true)}`;
    TF.modal('detail-dialog');
  }
  function showOrder(orderId) {
    const order = data.orders?.find((o) => o.id === orderId);
    if (!order) return;
    $('detail-dialog').dataset.order = orderId;
    $('detail-content').innerHTML =
      `<div class="modal-top"><h2>Order #${order.number}</h2><button class="icon-button" data-close aria-label="Close order">×</button></div><div class="section-title"><h3>${esc(order.table_label)}</h3>${badge(order.status)}</div><p class="muted">${new Date(order.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT</p><div class="basket-lines">${order.items.map((i) => `<div class="basket-line"><div class="basket-line-top"><strong>${i.quantity} × ${esc(i.name)}</strong><strong>${money(i.line_total)}</strong></div><p class="muted">${i.modifiers.map((m) => esc(m.name)).join(', ')}</p>${i.notes ? `<p class="kitchen-note">${esc(i.notes)}</p>` : ''}</div>`).join('')}</div>${order.notes ? `<p class="kitchen-note full-note">${esc(order.notes)}</p>` : ''}<div class="order-total"><span>Total</span><strong>${money(order.total)}</strong></div><p>Payment: <strong>${order.payment_status === 'PAID' ? 'Paid · cash recorded' : 'Unpaid'}</strong></p><div class="detail-actions">${availableActions(order)}${['MANAGER', 'SUPER_ADMIN'].includes(role) && order.status !== 'CANCELLED' && order.payment_status !== 'PAID' ? `<button class="button wide" data-paid="${order.id}">Record cash payment</button>` : ''}${['MANAGER', 'SUPER_ADMIN'].includes(role) && ['NEW', 'ACCEPTED', 'PREPARING'].includes(order.status) && order.payment_status !== 'PAID' ? `<button class="button danger wide" data-cancel="${order.id}">Cancel order</button>` : ''}</div><h3 class="timeline-title">Order timeline</h3><ol class="timeline">${order.events.map((e) => `<li><strong>${names[e.status]}</strong><span>${time(e.created_at)}</span></li>`).join('')}</ol>`;
    TF.modal('detail-dialog');
  }
  async function changeStatus(button, orderId, status) {
    await TF.busy(button, async () => {
      await TF.api(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
      TF.toast(`Order ${names[status].toLowerCase()}.`);
    });
  }
  function confirmAction(title, description, action) {
    editor(title, `<p>${description}</p>`, action, 'Confirm');
  }
  function exportOrders() {
    const cell = (value) => {
      const text = String(value);
      return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
    };
    const rows = [
      ['Order', 'Table', 'Status', 'Payment', 'Total TZS', 'Created at'],
      ...data.orders.map((o) => [
        o.number,
        o.table_label,
        o.status,
        o.payment_status,
        o.total,
        o.created_at,
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'tableflow-orders.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const actionHandlers = {
    refresh: load,
    kitchen: () => location.assign(`/staff?branch=${branch}`),
    tables: () => location.assign(`/manager/tables?branch=${branch}`),
    'add-dish': () => dishEditor(),
    categories: showCategories,
    'add-category': () => {
      $('detail-dialog').close();
      simpleName('Add a category', '/categories');
    },
    'add-table': () => simpleName('Add a table', '/tables'),
    'add-branch': () =>
      editor(
        'Add a branch',
        input('Branch name', 'name', '', 'text', 'required maxlength="100"') +
          input(
            'WhatsApp phone (international)',
            'phone',
            '',
            'text',
            'placeholder="+255712345678" maxlength="40"',
          ),
        (values) =>
          TF.api('/branches', { method: 'POST', body: JSON.stringify(values) }).then(() =>
            location.reload(),
          ),
        'Create branch',
      ),
    'add-business': () =>
      editor(
        'Add a business',
        input('Business name', 'name', '', 'text', 'required maxlength="100"') +
          input('First branch name', 'branch_name', '', 'text', 'required maxlength="100"'),
        (values) =>
          TF.api('/platform/businesses', { method: 'POST', body: JSON.stringify(values) }).then(
            () => location.reload(),
          ),
      ),
    'add-staff': () =>
      editor(
        'Add a team member',
        input('Full name', 'name', '', 'text', 'required maxlength="100"') +
          input('Email address', 'email', '', 'email', 'required autocomplete="off"') +
          input(
            'Initial password',
            'password',
            '',
            'password',
            'required minlength="12" maxlength="128" autocomplete="new-password"',
          ) +
          '<label>Role<select name="role"><option value="KITCHEN">Kitchen</option><option value="WAITER">Waiter</option><option value="MANAGER">Manager · all business branches</option></select></label><p class="fine-print">Share these credentials with your team member directly. This form does not send an email.</p>',
        (values) => TF.api('/staff', { method: 'POST', body: JSON.stringify(values) }),
        'Create account',
      ),
    export: exportOrders,
  };
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button,a,[data-order]');
    if (!target) return;
    const d = target.dataset;
    if (d.action) {
      actionHandlers[d.action]?.();
      return;
    }
    if (d.order) {
      showOrder(d.order);
      return;
    }
    if (d.transition) {
      changeStatus(target, d.id, d.transition);
      return;
    }
    if (d.availability) {
      const item = data.menu.items.find((i) => i.id === d.availability);
      TF.busy(target, async () => {
        await TF.api(`/menu-items/${item.id}/availability`, {
          method: 'PATCH',
          body: JSON.stringify({ available: !item.available }),
        });
        await load();
        TF.toast(item.available ? 'Dish marked sold out.' : 'Dish is available.');
      });
    }
    if (d.editDish) dishEditor(data.menu.items.find((i) => i.id === d.editDish));
    if (d.editCategory) {
      $('detail-dialog').close();
      simpleName(
        'Rename category',
        `/categories/${d.editCategory}`,
        data.menu.categories.find((c) => c.id === d.editCategory).name,
        'PATCH',
      );
    }
    if (d.deleteCategory) {
      $('detail-dialog').close();
      confirmAction('Delete category?', 'Only empty categories can be deleted.', () =>
        TF.api(`/categories/${d.deleteCategory}`, { method: 'DELETE' }),
      );
    }
    if (d.renameTable)
      simpleName(
        'Rename table',
        `/tables/${d.renameTable}`,
        data.tables.tables.find((t) => t.id === d.renameTable).label,
        'PATCH',
      );
    if (d.editQr) {
      const q = data.tables.codes.find((x) => x.id === d.editQr);
      editor(
        'Manage QR destination',
        `<p class="muted">The printed code stays the same. Existing customer sessions must scan again when the destination changes.</p><label>Destination table<select name="table_id">${data.tables.tables.map((t) => `<option value="${t.id}" ${q.table_id === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label><label class="checkbox-label"><input type="checkbox" name="active" ${q.active ? 'checked' : ''}>QR code is active</label>`,
        (_v, form) =>
          TF.api(`/qr-codes/${q.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              table_id: form.elements.table_id.value,
              active: form.elements.active.checked,
            }),
          }),
      );
    }
    if (d.print) window.open(`/print/qr/${d.print}?branch=${branch}`, '_blank', 'noopener');
    if (d.request)
      TF.busy(target, async () => {
        await TF.api(`/requests/${d.request}`, { method: 'PATCH' });
        await load();
      });
    if (d.paid)
      confirmAction(
        'Record cash payment?',
        `Confirm that you received the full cash amount for this order.`,
        () => TF.api(`/orders/${d.paid}/payment`, { method: 'PATCH' }),
      );
    if (d.cancel)
      confirmAction(
        'Cancel this order?',
        'The customer will see that their order has been cancelled.',
        () =>
          TF.api(`/orders/${d.cancel}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'CANCELLED' }),
          }),
      );
    if (d.toggleStaff)
      confirmAction(
        d.active === '1' ? 'Enable this account?' : 'Disable this account?',
        d.active === '1'
          ? 'This person will be able to sign in again.'
          : 'Active sessions will be revoked.',
        () =>
          TF.api(`/staff/${d.toggleStaff}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: d.active === '1' }),
          }),
      );
    if (d.business)
      confirmAction(
        d.active === '1' ? 'Activate business?' : 'Pause business?',
        d.active === '1'
          ? 'The business can receive orders again.'
          : 'New orders and business staff sign-in will be blocked.',
        () =>
          TF.api(`/platform/businesses/${d.business}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: d.active === '1' }),
          }),
      );
  });
  document.addEventListener('keydown', (e) => {
    if (['Enter', ' '].includes(e.key) && e.target.matches('tr[data-order]')) {
      e.preventDefault();
      showOrder(e.target.dataset.order);
    }
  });
  document.addEventListener('input', (e) => {
    if (['item-search', 'order-search'].includes(e.target.id)) {
      filter = e.target.value.toLowerCase();
      render();
    }
  });
  $('logout').addEventListener('click', (e) =>
    TF.busy(e.currentTarget, async () => {
      await TF.api('/auth/logout', { method: 'POST' });
      location.assign('/login');
    }),
  );
  $('branch-switch').addEventListener('change', (e) => {
    const url = new URL(location.href);
    url.searchParams.set('branch', e.target.value);
    location.assign(url);
  });
  $('sidebar-toggle').addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('nav-open');
    $('sidebar-toggle').setAttribute('aria-expanded', String(isOpen));
  });
  load();
  if (branch)
    TF.live(
      'staff',
      () => {
        if (['overview', 'orders', 'kitchen', 'menu'].includes(section) && !$('editor-dialog').open)
          load();
      },
      (connected) => {
        $('live-state').innerHTML =
          `<span class="dot ${connected ? '' : 'offline'}"></span>${connected ? 'Live updates' : 'Reconnecting'}`;
      },
    );
  else $('live-state').hidden = true;
})();
