'use strict';
(() => {
  const $ = (id) => document.getElementById(id),
    esc = TF.escape,
    money = TF.money,
    token = document.body.dataset.token;
  const storageKey = `tableflow:basket:${token}`,
    pendingKey = `tableflow:pending:${token}`,
    cacheKey = `tableflow:menu:${token}`;
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  let cart = read(storageKey, []),
    pending = read(pendingKey, null),
    menu = null,
    category = 'all',
    query = '',
    fresh = false,
    orders = [],
    loading = false;
  if (!Array.isArray(cart)) cart = [];
  function connection(message) {
    $('connection-note').hidden = !message;
    $('connection-note').textContent = message ?? '';
  }
  function save() {
    write(storageKey, cart);
    write(pendingKey, pending);
    renderBasketBar();
  }
  function lineTotal(line) {
    return (line.price + line.modifiers.reduce((sum, m) => sum + m.price, 0)) * line.quantity;
  }
  function total() {
    return cart.reduce((sum, line) => sum + lineTotal(line), 0);
  }
  function renderBasketBar() {
    const count = cart.reduce((sum, line) => sum + line.quantity, 0);
    $('basket-bar').hidden = !count;
    $('basket-count').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
    $('basket-total').textContent = money(total());
  }
  function renderMenu() {
    if (!menu) return;
    $('categories').innerHTML = [{ id: 'all', name: 'All dishes' }, ...menu.categories]
      .map(
        (c) =>
          `<button class="category-tab ${category === c.id ? 'selected' : ''}" data-category="${esc(c.id)}" aria-pressed="${category === c.id}">${esc(c.name)}</button>`,
      )
      .join('');
    const shown = menu.items.filter(
      (i) =>
        (category === 'all' || i.category_id === category) &&
        `${i.name} ${i.description} ${i.dietary}`.toLowerCase().includes(query),
    );
    $('menu-content').innerHTML =
      menu.categories
        .map((c) => {
          const items = shown.filter((i) => i.category_id === c.id);
          if (!items.length) return '';
          return `<section class="menu-section"><div class="section-title"><h2>${esc(c.name)}</h2><span>${items.length} dishes</span></div><div class="dish-grid">${items.map((item) => `<article class="dish-card ${item.available ? '' : 'unavailable'}">${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.name)}" class="dish-image" loading="lazy" width="240" height="180">` : ''}<div class="dish-copy"><div class="dish-top"><h3>${esc(item.name)}</h3>${item.dietary ? `<span class="dietary">${esc(item.dietary)}</span>` : ''}</div><p>${esc(item.description)}</p><div class="dish-bottom"><div><strong>${money(item.price)}</strong><span class="muted">${item.available ? `${item.prep_minutes} min` : 'Currently unavailable'}</span></div><button class="add-dish" data-dish="${item.id}" aria-label="Customize ${esc(item.name)}" ${!item.available ? 'disabled' : ''}>+</button></div></div></article>`).join('')}</div></section>`;
        })
        .join('') ||
      '<div class="empty-state"><h3>No dishes found.</h3><p>Try another search or category.</p></div>';
    $('menu-content')
      .querySelectorAll('img')
      .forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
  }
  async function loadMenu() {
    try {
      const data = await TF.api(`/public/menu/${token}`);
      TF.csrf = data.csrf;
      menu = data;
      fresh = true;
      const { csrf, ...cached } = data;
      write(cacheKey, cached);
      connection(
        navigator.onLine ? '' : 'You’re offline. You can browse, but ordering needs a connection.',
      );
      renderMenu();
    } catch (error) {
      fresh = false;
      if (!menu) menu = read(cacheKey, null);
      if (menu) {
        renderMenu();
        connection('Showing a saved menu. Reconnect before ordering.');
      } else {
        $('menu-content').innerHTML =
          `<div class="empty-state"><h3>The menu couldn’t load.</h3><p>${esc(error.message)}</p><button class="button" id="reload-menu">Try again</button></div>`;
      }
    }
  }
  function openDish(itemId) {
    if (pending) {
      TF.toast('Please confirm your pending order before changing the basket.');
      openBasket();
      return;
    }
    const item = menu.items.find((i) => i.id === itemId);
    if (!item || !item.available) return;
    $('dish-detail').innerHTML =
      `<div class="modal-top"><p class="eyebrow">MAKE IT YOURS</p><button class="icon-button" data-close aria-label="Close dish">×</button></div><h2>${esc(item.name)}</h2><p class="muted">${esc(item.description)}</p><form id="dish-form"><div class="modifier-options">${item.modifiers.map((m) => `<label class="modifier-option"><span><input type="checkbox" name="modifier" value="${esc(m.id)}">${esc(m.name)}</span><strong>+ ${money(m.price)}</strong></label>`).join('')}</div><label>Special instructions<textarea name="notes" maxlength="300" rows="2" placeholder="Less spice, no onions…"></textarea></label><p class="fine-print">Food allergy? Please speak with your waiter before ordering.</p><div class="basket-line-bottom"><div class="stepper"><button type="button" data-step="-1" aria-label="Decrease quantity">−</button><output id="dish-quantity">1</output><button type="button" data-step="1" aria-label="Increase quantity">+</button></div><strong id="dish-price">${money(item.price)}</strong></div><button class="button primary wide" type="submit">Add to order</button></form>`;
    let quantity = 1;
    const form = $('dish-form');
    const update = () => {
      $('dish-quantity').textContent = quantity;
      const ids = [...form.querySelectorAll(':checked')].map((x) => x.value);
      $('dish-price').textContent = money(
        (item.price +
          item.modifiers.filter((m) => ids.includes(m.id)).reduce((s, m) => s + m.price, 0)) *
          quantity,
      );
    };
    form.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]');
      if (step) {
        quantity = Math.max(1, Math.min(20, quantity + Number(step.dataset.step)));
        update();
      }
    });
    form.addEventListener('change', update);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (cart.length >= 30) {
        TF.toast('Your basket has reached 30 lines. Please submit it first.');
        return;
      }
      const ids = [...form.querySelectorAll(':checked')].map((x) => x.value);
      cart.push({
        key: TF.uuid(),
        id: item.id,
        name: item.name,
        price: item.price,
        quantity,
        modifiers: item.modifiers.filter((m) => ids.includes(m.id)),
        notes: new FormData(form).get('notes').trim(),
      });
      save();
      $('dish-dialog').close();
      TF.toast(`${item.name} added to your order.`);
    });
    TF.modal('dish-dialog');
  }
  function openBasket() {
    renderBasket();
    TF.modal('basket-dialog');
  }
  function renderBasket() {
    const note = $('order-note')?.value ?? pending?.body.notes ?? '';
    $('basket-detail').innerHTML =
      `<div class="modal-top"><h2>Your order</h2><button class="icon-button" data-close aria-label="Close basket">×</button></div><p class="muted">${esc(menu?.venue.label ?? 'Your table')} · ${esc(menu?.venue.business_name ?? '')}</p>${cart.length ? `<div class="basket-lines">${cart.map((line, index) => `<article class="basket-line"><div class="basket-line-top"><h3>${esc(line.name)}</h3><strong>${money(lineTotal(line))}</strong></div><p class="muted">${line.modifiers.map((m) => esc(m.name)).join(', ')}${line.notes ? ` · ${esc(line.notes)}` : ''}</p><div class="basket-line-bottom"><div class="stepper"><button data-quantity="-1" data-index="${index}" aria-label="Decrease ${esc(line.name)} quantity" ${pending ? 'disabled' : ''}>−</button><output>${line.quantity}</output><button data-quantity="1" data-index="${index}" aria-label="Increase ${esc(line.name)} quantity" ${pending ? 'disabled' : ''}>+</button></div><button class="text-button" data-remove="${index}" ${pending ? 'disabled' : ''}>Remove</button></div></article>`).join('')}</div><label>A note for the kitchen<textarea id="order-note" rows="2" maxlength="500" placeholder="Anything else we should know?" ${pending ? 'disabled' : ''}>${esc(note)}</textarea></label><div class="order-total"><span>Total</span><strong>${money(total())}</strong></div><p class="fine-print">Menu prices are final. No additional fee is added. Pay with your waiter.</p><p id="submit-message" class="error-text" role="alert">${pending ? 'We haven’t confirmed this order yet. Retry safely with the same order.' : ''}</p><button id="submit-order" class="button primary wide">${pending ? 'Retry order confirmation' : 'Send order to kitchen'}</button>${pending ? '<button id="clear-pending" class="text-button">I have checked this pending order with my waiter</button>' : ''}` : '<div class="empty-state"><h3>A little hungry?</h3><p>Add something from the menu to begin.</p><button class="button" data-close>Explore the menu</button></div>'}`;
  }
  function reconcile() {
    let changed = false;
    cart = cart
      .map((line) => {
        const item = menu.items.find((i) => i.id === line.id);
        if (!item || !item.available) {
          changed = true;
          return null;
        }
        const modifiers = line.modifiers
          .map((m) => item.modifiers.find((x) => x.id === m.id))
          .filter(Boolean);
        if (
          item.price !== line.price ||
          JSON.stringify(modifiers) !== JSON.stringify(line.modifiers)
        )
          changed = true;
        return { ...line, name: item.name, price: item.price, modifiers };
      })
      .filter(Boolean);
    save();
    return changed;
  }
  async function submit(button) {
    await TF.busy(button, async () => {
      if (!navigator.onLine) throw new Error('You’re offline. Reconnect to send your order.');
      if (pending && pending.session !== menu?.session_id)
        throw new Error(
          'This pending order belongs to an earlier table session. Check with your waiter before starting another order.',
        );
      if (!pending) {
        await loadMenu();
        if (!fresh) throw new Error('The menu could not be verified. Please retry.');
        if (reconcile()) {
          renderBasket();
          throw new Error(
            'Your basket was updated with current prices and availability. Please review it before ordering.',
          );
        }
        if (!cart.length) throw new Error('Please add a dish first.');
        pending = {
          key: TF.uuid(),
          session: menu.session_id,
          body: {
            expected_total: total(),
            items: cart.map((line) => ({
              id: line.id,
              quantity: line.quantity,
              modifiers: line.modifiers.map((m) => m.id),
              notes: line.notes,
            })),
            notes: $('order-note').value.trim(),
          },
        };
        save();
      }
      $('basket-detail')
        .querySelectorAll('[data-quantity],[data-remove],#order-note')
        .forEach((control) => (control.disabled = true));
      try {
        await TF.api('/public/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': pending.key },
          body: JSON.stringify(pending.body),
        });
        pending = null;
        cart = [];
        save();
        $('basket-dialog').close();
        await loadOrders();
        TF.modal('orders-dialog');
        TF.toast('Order received. Your kitchen has it.');
      } catch (error) {
        if ([400, 409, 410, 413].includes(error.status)) {
          pending = null;
          save();
        }
        $('submit-message').textContent = pending
          ? 'Confirmation hasn’t arrived. Your basket is saved. Retry to check the same order.'
          : error.message;
        button.textContent = pending ? 'Retry order confirmation' : 'Send order to kitchen';
        throw error;
      }
    });
    $('basket-detail')
      .querySelectorAll('[data-quantity],[data-remove],#order-note')
      .forEach((control) => (control.disabled = Boolean(pending)));
    if ($('submit-order'))
      $('submit-order').textContent = pending
        ? 'Retry order confirmation'
        : 'Send order to kitchen';
  }
  const labels = {
    NEW: 'Received',
    ACCEPTED: 'Accepted',
    PREPARING: 'In the kitchen',
    READY: 'Ready to serve',
    SERVED: 'Enjoy your meal',
    CANCELLED: 'Cancelled',
  };
  async function loadOrders() {
    try {
      orders = await TF.api('/public/orders');
      $('order-count').textContent = orders.length
        ? `(${orders.filter((o) => !['SERVED', 'CANCELLED'].includes(o.status)).length})`
        : '';
      $('customer-orders').innerHTML =
        orders
          .map(
            (order) =>
              `<article class="customer-order"><div class="section-title"><h3>Order #${order.number}</h3><span class="status ${order.status.toLowerCase()}">${labels[order.status]}</span></div><p class="muted">${new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${money(order.total)}</p><div class="order-progress" aria-label="${labels[order.status]}">${['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'].map((step, i) => `<span class="${order.status !== 'CANCELLED' && i <= ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'].indexOf(order.status) ? 'complete' : ''}"></span>`).join('')}</div>${order.items.map((i) => `<p>${i.quantity} × ${esc(i.name)}</p>`).join('')}<p class="fine-print">${order.payment_status === 'PAID' ? 'Payment recorded by your team.' : 'Payment with your waiter.'}</p></article>`,
          )
          .join('') ||
        '<div class="empty-state"><h3>Your first order starts here.</h3><p>Browse the menu and choose something you’ll love.</p></div>';
    } catch (error) {
      if ($('orders-dialog').open) TF.toast(error.message);
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      await loadMenu();
      await loadOrders();
    } finally {
      loading = false;
    }
  }
  document.addEventListener('click', (e) => {
    const dish = e.target.closest('[data-dish]');
    if (dish) openDish(dish.dataset.dish);
    const tab = e.target.closest('[data-category]');
    if (tab) {
      category = tab.dataset.category;
      renderMenu();
    }
    if (e.target.closest('#reload-menu')) loadMenu();
    const quantity = e.target.closest('[data-quantity]');
    if (quantity && !pending) {
      const line = cart[Number(quantity.dataset.index)];
      line.quantity = Math.max(1, Math.min(20, line.quantity + Number(quantity.dataset.quantity)));
      save();
      renderBasket();
    }
    const remove = e.target.closest('[data-remove]');
    if (remove && !pending) {
      cart.splice(Number(remove.dataset.remove), 1);
      save();
      renderBasket();
    }
    if (
      e.target.closest('#clear-pending') &&
      confirm(
        'Only continue after your waiter confirms whether the earlier order arrived. Clear its pending confirmation and review your basket?',
      )
    ) {
      pending = null;
      save();
      renderBasket();
    }
    const submitButton = e.target.closest('#submit-order');
    if (submitButton) submit(submitButton);
    const service = e.target.closest('[data-service]');
    if (service)
      TF.busy(service, async () => {
        await TF.api('/public/requests', {
          method: 'POST',
          body: JSON.stringify({ kind: service.dataset.service }),
        });
        TF.toast(
          service.dataset.service === 'BILL'
            ? 'Your waiter has your bill request.'
            : 'Your waiter has been notified.',
        );
      });
  });
  $('menu-search').addEventListener('input', (e) => {
    query = e.target.value.trim().toLowerCase();
    renderMenu();
  });
  $('basket-bar').addEventListener('click', openBasket);
  $('my-orders').addEventListener('click', async () => {
    await loadOrders();
    TF.modal('orders-dialog');
  });
  window.addEventListener('offline', () =>
    connection('You’re offline. Browse the menu and reconnect before ordering.'),
  );
  window.addEventListener('online', refresh);
  renderBasketBar();
  refresh();
  TF.live('customer', refresh, (connected) => {
    if (!connected) connection('Reconnecting to live updates. Your order remains saved.');
    else if (fresh) connection('');
  });
})();
