# Local use and deployment

## Production build

Use Node.js 24.x and run commands from the project root:

```bash
npm ci
cp .env.example .env
npm run setup
npm run verify
npm start
```

If setup was already completed, keep the existing `.env` and database. Do not run a second application against a different accidental working directory. `npm start` reads views and assets from `src/` and compiled JavaScript from `dist/`.

## HTTPS reverse proxy

For an internet-facing pilot, terminate HTTPS at a reverse proxy. Example application settings:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=9367
PUBLIC_URL=https://menu.example.com
COOKIE_SECURE=true
TRUST_PROXY=loopback
DATABASE_PATH=./data/tableflow.sqlite
```

Use your actual domain instead of `menu.example.com`. The process intentionally refuses production mode without an HTTPS origin and secure cookies.

An Nginx location inside your existing HTTPS server block can proxy both HTTP and WebSockets:

```nginx
location / {
    proxy_pass http://127.0.0.1:9367;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
    client_max_body_size 64k;
}
```

This example assumes the trusted proxy is on the same machine and the backend port is not directly exposed. Do not set `TRUST_PROXY=true` globally. If your proxy is remote, configure its exact trusted address or subnet and the host firewall accordingly.

`PUBLIC_URL` is also the allowed Origin. If login returns an origin error, use the exact configured hostname and scheme. If a proxy adds `X-Forwarded-For`, configure the trusted proxy correctly instead of suppressing the rate-limiter’s validation.

## Linux service

Adapt the paths and Linux user below. Use the output of `command -v node` for ExecStart; a system service does not inherit an interactive shell’s version-manager setup.

```ini
[Unit]
Description=Tableflow hospitality ordering
After=network.target

[Service]
Type=simple
User=tableflow
WorkingDirectory=/opt/tableflow
ExecStart=/usr/bin/node /opt/tableflow/dist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/tableflow/data
UMask=0077

[Install]
WantedBy=multi-user.target
```

Create a dedicated non-root service user, install the app in `/opt/tableflow`, create its data directory and make that directory writable by the service user. Ensure the service user can read the project and `.env`. Run setup under that account or transfer the database’s ownership to it. Save the unit as `/etc/systemd/system/tableflow.service`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tableflow
sudo systemctl status tableflow
journalctl -u tableflow -f
```

This guide provides commands; no service has been installed on your computer by this project archive.

## Backups

For the simplest reliable small-venue backup, stop the app so SQLite closes cleanly, then copy the data directory to a protected backup location. Preserve any SQLite WAL/SHM files if they are present. Do not copy only the main database file while the server is actively writing. For uninterrupted backups, implement SQLite’s online backup API and test restoration.

Back up `.env` separately and protect access. The database contains staff emails, hashed passwords, order notes and guest-session records. There is no automatic cloud backup in this MVP.

Before an upgrade, stop the process, back up the database, deploy code, run the required migration procedure and restart. This first release creates schema version 1 with `CREATE TABLE IF NOT EXISTS`. It is not a general schema migration framework.

## Pilot acceptance checklist

- Test a printed QR with at least two physical phones.
- Submit an order, disconnect during confirmation, then retry; confirm exactly one kitchen order exists.
- Sign in as a kitchen user and a waiter and verify role boundaries.
- Try a manager from a second business and confirm isolation.
- Mark an item sold out during an open customer session.
- Move a QR to another table and rescan it.
- Test large text, touch targets and narrow phone screens.
- Restart the server and verify historical orders remain intact.
- Restore a backup into a separate test directory.
- Set the venue’s retention policy and assess real hardware and peak-service load.

These physical-browser, load and restore checks remain for deployment. Automated HTTP, database and WebSocket checks are included in `npm test`.
