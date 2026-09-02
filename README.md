# Tableflow

A working QR ordering MVP for restaurants, cafes and hospitality venues. Guests scan a table code, customize a dish and send an order. Kitchen staff receive it over an authenticated WebSocket and move it through preparation to service.

Built with Node.js 24, TypeScript, Express 5, native SQLite, EJS and vanilla JavaScript. No React, frontend build pipeline, customer registration or default administrator password.

## Start in five commands

Use Node.js **24.x**. Run these commands from the extracted project directory:

```bash
cd tableflow
npm ci
cp .env.example .env
npm run setup
npm run dev
```

Open **http://127.0.0.1:9367**. Sign in with the account you created during setup.

Setup asks for your name, email and password, then creates a venue and eight tables. You can include a sample coastal menu priced in Tanzanian shillings. Sample dishes and prices are demonstration content. No customer orders or default staff accounts are seeded.

The first user is a platform administrator. To create a restaurant manager or kitchen account, open **Your team**. The first administrator can work in every venue; restaurant managers are limited to their own business.

## Try the full workflow

1. Open **Tables and QR** in the manager workspace.
2. Click the arrow on a table card to open its customer menu, or print its A6 table stand.
3. Choose a dish, add optional extras and put it in the basket.
4. Review the total, then send the order to the kitchen.
5. Open **Kitchen board** in another tab. Accept the order, start preparation, mark it ready and then served.
6. Return to **My orders** on the customer page to see the same status.
7. Open the order details as a manager and record cash payment only when payment has actually been received.
8. Change dish availability in **Menu studio**. Connected menus refresh immediately.

For guest isolation testing, use a separate browser profile or private window. Tabs in one browser profile share cookies. A customer device has one active table session at a time.

## Included

| Surface | Working capabilities |
| --- | --- |
| Customer menu | Table context, search, categories, optional add-ons, quantities, dietary notes, basket, server-confirmed ordering, order tracking, waiter and bill requests |
| Kitchen | Live incoming, preparing and ready columns; guarded state transitions; elapsed time; modifiers and notes; floor requests |
| Manager | Menu and category editing, price and availability changes, staff accounts, QR printing and reassignment, table creation and renaming, order history and CSV export |
| Reporting | Today’s ordered value, cash recorded, order count and top dishes, using East Africa Time |
| Platform | Create businesses and branches, activate or pause businesses, assign managers through the selected branch’s team screen |
| Backend | Versioned API, SQLite transactions and indexes, tenant checks, sessions, CSRF checks, idempotency, immutable audit records, WebSocket reconnect and polling fallback |

The layout is responsive, monochrome and touch friendly. Dialogs use the native HTML dialog element; controls support keyboard use, focus indicators and reduced motion. The included sample food photograph loads locally.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | One-time administrator and venue setup |
| `npm run dev` | Development server with restart on changes |
| `npm run typecheck` | TypeScript validation |
| `npm test` | HTTP, database, permission and WebSocket integration tests |
| `npm run build` | Compile the server to `dist/` |
| `npm start` | Run the compiled server from the project root |
| `npm run verify` | Typecheck, integration tests, production build |

The tests use an isolated temporary database and temporary HTTP port. They never modify `data/tableflow.sqlite`.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Network interface to listen on |
| `PORT` | `9367` | HTTP port |
| `PUBLIC_URL` | `http://127.0.0.1:9367` | Exact browser origin and QR base URL |
| `DATABASE_PATH` | `./data/tableflow.sqlite` | Persistent SQLite path |
| `COOKIE_SECURE` | `false` | Set `true` for HTTPS production |
| `TRUST_PROXY` | `false` | Trusted proxy addresses, such as `loopback` |
| `NODE_ENV` | `development` | Set `production` behind HTTPS |

There is no permissive cross-origin API configuration. The EJS pages and API use the same origin. Mutating requests must include the configured `Origin` and the session’s CSRF token. Use the exact configured URL, rather than switching between `localhost` and `127.0.0.1`.

For testing from a phone on your network, update `.env` with **your computer’s actual LAN IP**:

```dotenv
HOST=0.0.0.0
PORT=9367
PUBLIC_URL=http://192.168.1.127:9367
COOKIE_SECURE=false
TRUST_PROXY=false
```

Restart the server, allow the port through your local firewall if needed, then open the configured LAN URL. Reprint existing codes if you change `PUBLIC_URL`: the URL itself is physically encoded into the QR. Table reassignment within the same URL does not need reprinting. For durable printed stands, use a stable HTTPS domain before printing.

## How orders stay correct

- The server obtains prices and modifier prices from the current menu. The client does not set unit prices.
- `expected_total` detects a stale displayed total; changed totals require another customer review.
- Accepted orders retain item names, unit prices, modifier details, quantities and totals as snapshots.
- Order creation and its initial event run in one SQLite transaction.
- A client-generated idempotency key identifies the submission. The database enforces uniqueness per guest session. Reusing the key with different content returns 409.
- A timeout is treated as an unknown result. The basket retains the exact request and retries that request with the same key.
- Pending submissions retain their guest-session identity. A new table session cannot silently replay the old submission; the guest must check with staff first.
- Reconnects and periodic fetches recover state when WebSocket events were missed. The database remains authoritative.
- Marking an item unavailable prevents new purchases; a retry of an already accepted order still returns that original order.

## Source map

| Directory or file | Responsibility |
| --- | --- |
| `src/config/` | Environment validation |
| `src/database/` | Schema, connection and transactional SQL helpers |
| `src/middleware/auth.ts` | Staff and guest sessions, CSRF, origin and tenant scope |
| `src/modules/orders.ts` | Price snapshots, idempotency and state transitions |
| `src/modules/routes.ts` | Public, staff, management and platform APIs |
| `src/modules/schemas.ts` | Zod input validation |
| `src/modules/seed.ts` | Venue, table and optional sample-menu setup |
| `src/realtime/` | Cookie-authenticated, scoped WebSockets |
| `src/views/` | EJS pages and printable table stand |
| `src/public/` | Browser JavaScript, stylesheet and sample image |
| `tests/` | Integration tests |
| `docs/` | API, architecture, deployment and MVP boundaries |

## Practical limits

This is a functional MVP, not a claim of production certification or payment-provider approval.

- Cash recording is implemented. Mobile-money collection, payment webhooks, refunds and subscriptions are not integrated.
- Starter/Pro/Enterprise billing, WhatsApp forwarding, menu scheduling, inventory, custom domains and multi-server scaling are future modules.
- A photographed QR can be used remotely. QR possession does not prove physical presence. Add rotating visit codes or staff-opened table sessions if your pilot requires that protection.
- A loaded page can use its cached menu during a dropped connection. Orders require server acknowledgement. There is no service worker or guaranteed offline page reload.
- Customer cart and pending-request copies use browser local storage. Shared devices should clear that site data between customers.
- Orders and guests are retained until an operator applies a retention policy. Session expiry prevents further use; it does not delete historical records.
- History and CSV show the latest 100 orders. The kitchen board shows the oldest 100 active orders, with a visible notice at that limit. Full historical exports and cursor pagination are not implemented.
- SQLite and WebSocket fan-out run in one server process. Benchmark on the target hardware before a venue pilot. This is not configured for horizontally scaled deployment.
- No public password-reset email service or MFA is included. Protect the host and first administrator credentials.
- Views and static assets remain under `src/`; keep that directory when running the compiled server.

See [API reference](docs/API.md), [architecture](docs/ARCHITECTURE.md), [deployment guide](docs/DEPLOYMENT.md), [security notes](SECURITY.md) and [asset credits](docs/ASSETS.md).

## Validation

The included suite exercises real HTTP requests, SQLite writes and WebSocket delivery. It covers permissions, cross-tenant access, CSRF, idempotency, price changes, menu authoring, staff revocation, QR reassignment, order transitions, cash totals, printable QR responses and audit immutability. Browser interaction and physical-phone testing remain part of your local pilot checklist.

Project code is available under the [MIT license](LICENSE). The sample photograph has its own license listed in the credits.
