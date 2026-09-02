# Security notes

This release includes hashed passwords using Node’s scrypt, random opaque session tokens stored as SHA-256 hashes, HttpOnly SameSite cookies, production Secure cookies, Origin and CSRF validation, tenant-aware authorization, Zod input validation, parameterized SQL, Helmet headers, a restrictive script CSP and rate limits.

Staff sessions are revocable. Customers can view only their guest session’s orders. WebSocket upgrades require the configured origin and a valid session. Authorizations are rechecked during heartbeats. Audit rows cannot be changed through SQL UPDATE/DELETE because the database installs rejecting triggers; a host administrator with full database access can still remove triggers. This is not a tamper-proof remote audit service.

QR codes are bearer links. Sharing or photographing one can permit remote ordering at its table. Rate limits, guest order caps and QR deactivation reduce abuse but do not prove presence. For venues requiring stronger controls, add short-lived visit codes or a staff-opened table session before broad rollout.

Do not publish production databases, `.env`, session cookies, passwords or order notes in issues. Sample tests use deliberately non-production credentials only inside isolated temporary databases. No default production password is included.

Before a public pilot, configure HTTPS, use strong unique staff passwords, protect the host, back up and test restoration, define data retention, benchmark expected load and arrange an independent review. No percentage-security guarantee is made.

If publishing this repository, configure a private vulnerability reporting channel on its hosting provider. Report reproduction steps without real credentials or customer data. No support email is invented by this template.
