# Contributing

Install Node.js 24, run `npm ci`, then create a local `.env` and use `npm run setup`. Work on a branch and keep pull requests focused on a complete behavior.

Run `npm run verify` before submitting. Add integration coverage when changing money calculations, order transitions, guest-session behavior or tenant boundaries. UI-only copy and styling edits do not need mirrored tests.

Keep request validation in `src/modules/schemas.ts`, ordering invariants in the order service and branch authorization on every management endpoint. Never trust prices, branch IDs or roles just because a browser submitted them. Store historical price snapshots independently of the live catalog.

Use EJS and vanilla JavaScript for the client. Keep the guest path lightweight. Respect reduced-motion settings, use native semantic controls and test phone layouts. Avoid adding client dependencies without a clear need.

Describe the concrete problem, final behavior and validation in each pull request. Document schema changes, migration steps and compatibility limits. Never commit runtime databases, credentials or generated private QR links from a real venue.
