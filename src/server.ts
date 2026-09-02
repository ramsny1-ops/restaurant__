import { createServer } from 'node:http';
import { app } from './app.js';
import { config } from './config/index.js';
import { db } from './database/index.js';
import { attachRealtime } from './realtime/index.js';
const server = createServer(app);
server.requestTimeout = 15000;
server.headersTimeout = 20000;
const closeRealtime = attachRealtime(server);
server.listen(config.port, config.host, () => {
  console.log(`Tableflow is running at ${config.publicUrl}`);
  console.log(`Customer URL: ${config.publicUrl}`);
  if (config.allowedOrigins && Array.isArray(config.allowedOrigins)) {
    console.log('Allowed origins:', config.allowedOrigins.join(', '));
  }
  console.log(`Listening on ${config.host}:${config.port}`);
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  closeRealtime();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
