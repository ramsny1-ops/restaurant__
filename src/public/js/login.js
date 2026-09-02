'use strict';
document.getElementById('login-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const error = document.getElementById('login-error');
  button.disabled = true;
  button.classList.add('is-loading');
  error.textContent = '';
  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message ?? 'Sign in failed. Please try again.');
    location.assign(data.data.redirect);
  } catch (e) {
    error.textContent =
      e.name === 'TimeoutError' ? 'Connection timed out. Please try again.' : e.message;
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
});
