# Validation record

Validated on Node.js v24.19.0.

- `npm run typecheck`: passed.
- `npm test`: passed, 19 integration scenarios plus their parent test (20 reported test nodes).
- `npm run build`: passed.
- Browser JavaScript syntax checks: passed.
- Interactive CLI setup using an isolated test database: passed; created one administrator, eight tables and ten optional sample dishes.
- EJS customer, sign-in, kitchen and management responses: rendered successfully in the HTTP integration suite.
- QR SVG generation and printable PNG QR page: returned successfully in the integration suite.
- WebSocket order notification: delivered through a real authenticated connection in the test process.

The final customer retry behavior also retains an uncertain submission through authentication, CSRF and rate-limit rejections. Those rejections happen before order lookup and do not establish whether an earlier request was accepted.

No physical-phone, browser automation, visual screenshot, payment-provider or load testing was performed. A deployment/pilot checklist is included in `DEPLOYMENT.md`.
