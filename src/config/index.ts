import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (existsSync('.env')) {
  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, k, v] = m;
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
const port = Number(process.env.PORT ?? 9367);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const envPublic = process.env.PUBLIC_URL;
const ngrokEnv = process.env.NGROK_URL;
let publicUrl = new URL(envPublic ?? `http://127.0.0.1:${port}`);
if (ngrokEnv) {
  const ngrokUrl = new URL(ngrokEnv);
  if (ngrokUrl.pathname !== '/' || ngrokUrl.protocol !== 'https:')
    throw new Error('NGROK_URL must be an HTTPS origin with no path (e.g. https://abcd.ngrok.io)');
  // If PUBLIC_URL not explicitly set, prefer NGROK_URL as the public URL (useful when tunnelling)
  if (!envPublic) publicUrl = ngrokUrl;
}
if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.pathname !== '/')
  throw new Error('PUBLIC_URL must be an HTTP origin');
const production = process.env.NODE_ENV === 'production';
const secure = process.env.COOKIE_SECURE === 'true';
if (production && (!secure || publicUrl.protocol !== 'https:'))
  throw new Error('Production requires HTTPS PUBLIC_URL and COOKIE_SECURE=true');
export const config = Object.freeze({
  port,
  host: process.env.HOST ?? '127.0.0.1',
  publicUrl: publicUrl.origin,
  // Allowed origins: can be overridden with a comma-separated ALLOWED_ORIGINS env var
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    `${publicUrl.origin},http://127.0.0.1:${port},http://localhost:${port}${ngrokEnv ? ',' + ngrokEnv : ''}`
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  production,
  secure,
  database: resolve(process.env.DATABASE_PATH ?? './data/tableflow.sqlite'),
  trustProxy: (() => {
    if (typeof process.env.TRUST_PROXY !== 'undefined') {
      const v = String(process.env.TRUST_PROXY).trim().toLowerCase();
      if (v === 'false' || v === '0') return false;
      if (v === 'true' || v === '1') return true;
      return process.env.TRUST_PROXY;
    }
    // Default to trusting proxy when running in production or when NGROK_URL is set
    return production || !!ngrokEnv;
  })(),
});
