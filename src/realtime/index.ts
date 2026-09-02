import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config/index.js';
import { getUser, getGuest, branchesFor, guestActive } from '../middleware/auth.js';
type Client = {
  socket: WebSocket;
  branch: string;
  guest?: string;
  cookie?: string;
  alive: boolean;
};
const clients = new Set<Client>();
export function broadcast(branch: string, event: string, guest?: string) {
  for (const client of clients) {
    if (client.branch !== branch || client.socket.readyState !== WebSocket.OPEN) continue;
    if (guest && client.guest && client.guest !== guest) continue;
    if (event === 'service.changed' && client.guest) continue;
    client.socket.send(JSON.stringify({ type: event }));
  }
}
export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', config.publicUrl);
      if (
        url.pathname !== '/live' ||
        !req.headers.origin ||
        !config.allowedOrigins.includes(req.headers.origin)
      ) {
        socket.destroy();
        return;
      }
      let branch: string | undefined;
      let guestId: string | undefined;
      const user = getUser(req.headers.cookie);
      const guest = getGuest(req.headers.cookie);
      if (url.searchParams.get('audience') === 'staff' && user) {
        branch = branchesFor(user).find((b) => b.id === url.searchParams.get('branch'))?.id;
      } else if (guest && guestActive(guest)) {
        branch = guest.branch_id;
        guestId = guest.id;
      }
      if (
        !branch ||
        clients.size >= 500 ||
        [...clients].filter((c) => c.cookie === req.headers.cookie).length >= 8
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = {
          socket: ws,
          branch: branch!,
          guest: guestId,
          cookie: req.headers.cookie,
          alive: true,
        };
        clients.add(client);
        ws.on('pong', () => (client.alive = true));
        ws.on('error', () => ws.terminate());
        ws.on('close', () => clients.delete(client));
        ws.send(JSON.stringify({ type: 'connected' }));
      });
    } catch {
      socket.destroy();
    }
  });
  const timer = setInterval(() => {
    for (const client of clients) {
      const principal = client.guest ? getGuest(client.cookie) : getUser(client.cookie);
      const allowed =
        principal &&
        (client.guest
          ? guestActive(principal as any)
          : branchesFor(principal as any).some((b) => b.id === client.branch));
      if (!client.alive || !allowed) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 30000);
  timer.unref();
  return () => {
    clearInterval(timer);
    for (const c of clients) c.socket.terminate();
    wss.close();
  };
}
