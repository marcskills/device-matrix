// Template: copy into your repo without ".template" in the name, then change every line marked ADAPT.
// The matrix's backend: an embedded PostgreSQL and the repository's own disposable QA API
// (the reference app's backend/scripts/launch-qa-server.ts: fake Google identities and fixed content),
// seeded through the API itself with the accounts the screens need.
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PG_PORT = Number(process.env.DEVICE_MATRIX_PG_PORT ?? 55442);
const PG_PASSWORD = 'device-matrix-only';

async function waitFor(check, what, timeoutMs, gone = () => false) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (gone()) throw new Error(`${what} exited`);
    try { if (await check()) return; } catch { /* Not up yet. */ }
    if (Date.now() > until) throw new Error(`${what} did not start in ${timeoutMs / 1000} s`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

const exited = child => child.exitCode !== null || child.signalCode !== null;

export async function startPostgres(home) {
  const require = createRequire(join(home, 'pg', 'package.json'));
  const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres')).href);
  // Importing embedded-postgres hooks SIGINT/SIGTERM/SIGHUP to stop its database and exit at once, which would
  // skip run.mjs's own cleanup (the emulators and the QA API). run.mjs handles those signals itself.
  const exitHook = createRequire(require.resolve('embedded-postgres'))('async-exit-hook');
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) exitHook.unhookEvent(signal);
  // A fresh cluster each run: the QA API makes its own database in it anyway.
  const dir = join(home, 'pg', `data-${process.pid}`);
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: PG_PASSWORD, port: PG_PORT, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  // The roles the schema grants to, as on Supabase.
  for (const role of ['anon', 'authenticated', 'service_role']) await client.query(`create role ${role} nologin`);
  await client.end();
  return {
    url: `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
    // A Ctrl-C reaches the database too (it shares run.mjs's process group), and stop() would then wait for an
    // exit that has already happened: only its folder is left to remove.
    stop: async () => {
      if (pg.process && pg.process.exitCode === null && pg.process.signalCode === null) await pg.stop();
      else await rm(dir, { recursive: true, force: true });
    },
    // For an exit that cannot wait (run.mjs's 'exit' handler): the server, at once.
    kill: () => { try { pg.process?.kill('SIGINT'); } catch { /* Already gone. */ } },
  };
}

/** The QA API in its own process group, so stopping it stops tsx and the server, not only a launcher. */
// ADAPT: start your own test API. It must answer GET /health, listen on DEVICE_MATRIX_API_PORT and use the database
// at postgresUrl (or none). Returns { base, kill, stop }.
export async function startQaApi(backendDir, postgresUrl, port, log) {
  const child = spawn(join(backendDir, 'node_modules', '.bin', 'tsx'), ['scripts/launch-qa-server.ts'], {
    cwd: backendDir, env: { ...process.env, TEST_POSTGRES_URL: postgresUrl }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  child.stdout.on('data', chunk => log(String(chunk)));
  child.stderr.on('data', chunk => log(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already gone. */ } };
  try {
    await waitFor(async () => (await fetch(`${base}/health`)).ok, 'the QA API', 90_000, () => exited(child));
  } catch (error) { kill(); throw error; }
  return {
    base,
    kill,
    // Waits until the port is closed too, so its database can be stopped under no open connection.
    stop: async () => {
      if (!exited(child)) await new Promise(resolve => { child.once('exit', resolve); kill(); setTimeout(resolve, 10_000); });
      await waitFor(async () => { try { await fetch(`${base}/health`); return false; } catch { return true; } }, 'stopping the QA API', 10_000).catch(() => {});
    },
  };
}

/**
 * Seeds the accounts and returns, per account, what the phone stores to be signed in. The reference app made one
 * account per state its screens show: one with some days of history and two friends, one in the middle of today's
 * task, and one with nothing yet. It made them through its own API, the same endpoints the app calls.
 */
// ADAPT: make your accounts through your API. Returns { today, dates, accounts: { <name>: { token, userId } } }:
// run.mjs writes each account's token into the app's storage, and matrix.mjs screens name an account.
export async function seed(base) {
  const call = async (method, path, token, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  // ADAPT: your test sign-in. The reference backend accepted fake Google credentials in its test mode.
  const signIn = async (credential, profile) => {
    const { token, user } = await call('POST', '/api/auth/google', null, { credential });
    await call('PATCH', '/api/me', token, profile);
    return { token, userId: user.id };
  };
  // Long-ish names, so headers and rows carry a typical width.
  const player = await signIn('player', { name: 'Alexandra' });
  const midgame = await signIn('midgame', { name: 'Jonathan' });
  const fresh = await signIn('fresh', { name: 'Sam' });
  // ADAPT: create what each screen shows (history, friends, a half-finished task) through the app's own endpoints.
  const today = new Date().toISOString().slice(0, 10);
  return { today, dates: [today], accounts: { player, midgame, fresh } };
}
