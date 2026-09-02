import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import { one, run, db } from '../src/database/index.js';
import { id, passwordHash } from '../src/modules/common.js';
import { createBusiness } from '../src/modules/seed.js';
if (one('SELECT id FROM users LIMIT 1')) {
  console.log('Setup is already complete. Sign in with your existing account.');
  db.close();
  process.exit(0);
}
const rl = createInterface({ input: stdin, output: stdout });
try {
  console.log('Create the first platform administrator. No default account is installed.');
  const name = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(await rl.question('Your name: '));
  const email = z
    .email()
    .toLowerCase()
    .parse(await rl.question('Email: '));
  // Mute terminal echo for passwords while preserving readline input and paste support.
  const output = stdout.write.bind(stdout);
  let muted = false;
  (stdout as any).write = (...args: any[]) => (muted ? true : (output as any)(...args));
  let password = '';
  try {
    output('Password (12+ characters; hidden): ');
    muted = true;
    password = await rl.question('');
    muted = false;
    output('\n');
  } finally {
    (stdout as any).write = output;
  }
  z.string().min(12).max(128).parse(password);
  const venue = (await rl.question('Venue name [Coast House]: ')).trim() || 'Coast House';
  const branch = (await rl.question('Branch name [Dar es Salaam]: ')).trim() || 'Dar es Salaam';
  const seed =
    (await rl.question('Include a sample menu? Eight tables are created automatically. [Y/n]: '))
      .trim()
      .toLowerCase() !== 'n';
  const digest = await passwordHash(password);
  const business = createBusiness(venue, branch, seed);
  run(
    'INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)',
    id(),
    name,
    email,
    digest,
    'SUPER_ADMIN',
  );
  console.log(`Setup complete. Run npm run dev, then open /login. Venue created: ${venue}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
