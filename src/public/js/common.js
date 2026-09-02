'use strict';
const TF = {
  // randomUUID requires HTTPS outside localhost. getRandomValues also supports LAN HTTP pilots.
  uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
  csrf: document.querySelector('meta[name="csrf-token"]')?.content ?? '',
  escape: (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    ),
  money: (value) => `TZS ${new Intl.NumberFormat('en-TZ').format(value ?? 0)}`,
  async api(path, options = {}) {
    const { timeout = 12000, ...fetchOptions } = options;
    const response = await fetch(`/api/v1${path}`, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': TF.csrf,
        ...(document.body.dataset.branch ? { 'X-Branch-ID': document.body.dataset.branch } : {}),
        ...fetchOptions.headers,
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        body.error?.message ??
          (response.status === 429
            ? 'Too many requests. Please wait a moment.'
            : 'Unable to complete the request.'),
      );
      error.status = response.status;
      throw error;
    }
    return body.data;
  },
  toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(TF.toastTimer);
    TF.toastTimer = setTimeout(() => (el.hidden = true), 4500);
  },
  modal(id) {
    const el = document.getElementById(id);
    if (!el.open) el.showModal();
    return el;
  },
  async busy(button, action) {
    if (button.disabled) return;
    const text = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    try {
      await action();
    } catch (error) {
      TF.toast(
        error.name === 'TimeoutError' ? 'Connection timed out. Please retry.' : error.message,
      );
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.innerHTML = text;
    }
  },
  live(audience, onChange, onState) {
    let socket,
      retry = 1000,
      timer,
      closed = false;
    const connect = () => {
      if (closed) return;
      const url = new URL('/live', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('audience', audience);
      if (document.body.dataset.branch)
        url.searchParams.set('branch', document.body.dataset.branch);
      socket = new WebSocket(url);
      socket.onopen = () => {
        retry = 1000;
        onState?.(true);
        onChange();
      };
      socket.onmessage = (event) => {
        try {
          if (JSON.parse(event.data).type !== 'connected') onChange();
        } catch {}
      };
      socket.onclose = () => {
        onState?.(false);
        if (!closed) {
          timer = setTimeout(connect, retry);
          retry = Math.min(retry * 2, 15000);
        }
      };
      socket.onerror = () => socket.close();
    };
    connect();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') onChange();
    }, 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onChange();
    });
    window.addEventListener('pagehide', () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(poll);
      socket?.close();
    });
    return () => socket?.close();
  },
};
document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});
document.querySelectorAll('dialog').forEach((dialog) =>
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  }),
);
