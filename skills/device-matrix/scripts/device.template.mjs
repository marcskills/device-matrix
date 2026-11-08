// Template: copy into your repo without ".template" in the name, then change every line marked ADAPT.
// One headless emulator and what the matrix does on it: boot, apply a setup, open a screen with seeded storage,
// wait until it settles, scroll, take the picture and the UI dump.
import { execFile, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { matches, parseDump } from './analyze.mjs';

const run = promisify(execFile);
const PACKAGE = 'com.example.app'; // ADAPT: your applicationId
// ADAPT: where your app keeps the session it reads at start (this is expo-sqlite/kv-store). See ENVIRONMENT.md.
const STORAGE = `/data/data/${PACKAGE}/files/SQLite/ExpoSQLiteStorage`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Device {
  constructor(port, log) {
    this.port = port;
    this.serial = `emulator-${port}`;
    this.log = message => log(`[${this.serial}] ${message}`);
  }

  async adb(args, options = {}) {
    const { stdout } = await run('adb', ['-s', this.serial, ...args], { maxBuffer: 64 << 20, encoding: options.encoding ?? 'utf8', timeout: options.timeout ?? 60_000 });
    return stdout;
  }
  shell(command, options) { return this.adb(['shell', command], options); }

  /** Starts a read-only instance of the matrix's AVD (several can share it) and waits for Android to boot. */
  async boot(avd, logFile) {
    const output = openSync(logFile, 'a');
    this.process = spawn('emulator', ['-avd', avd, '-port', String(this.port), '-read-only', '-no-window', '-no-audio',
      '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader_indirect'], { stdio: ['ignore', output, output], detached: true });
    // Its own process group (detached): a Ctrl-C in the terminal reaches run.mjs only, which then finishes the
    // screen in progress before it closes the emulators.
    this.process.on('exit', code => { this.exited = code ?? 'signal'; });
    const started = Date.now();
    while ((await this.shell('getprop sys.boot_completed', { timeout: 10_000 }).catch(() => '')).trim() !== '1') {
      if (this.exited !== undefined) throw new Error(`${this.serial}: the emulator exited (${this.exited}), see ${logFile}`);
      if (Date.now() - started > 240_000) throw new Error(`${this.serial} did not boot`);
      await sleep(1000);
    }
    // Root, to write the app's storage; the Google APIs images allow it. adb can drop the connection as it restarts.
    await this.adb(['root']).catch(async () => { await sleep(2000); await this.adb(['root']); });
    await sleep(1500);
    await this.adb(['wait-for-device'], { timeout: 60_000 });
    this.log(`booted in ${Math.round((Date.now() - started) / 1000)} s`);
  }

  /** Asks the emulator to close, so it deletes its disk overlay (~1.2 GB), and forces it after 20 s. */
  async kill() {
    if (!this.process || this.exited !== undefined) return;
    const closed = new Promise(resolve => this.process.once('exit', resolve));
    await this.adb(['emu', 'kill'], { timeout: 15_000 }).catch(() => {});
    await Promise.race([closed, sleep(20_000)]);
    this.killNow();
  }

  /** For an exit that cannot wait. */
  killNow() {
    try { this.process?.kill('SIGKILL'); } catch { /* Already gone. */ }
  }

  // ADAPT: install() and healthy() wait for the storage table seedStorage writes. Change them with seedStorage: for
  // an app whose session you cannot write, check `pm path <package>` instead (see ENVIRONMENT.md).
  async install(apk, dumper, apiPort) {
    await this.adb(['install', '-r', apk], { timeout: 180_000 });
    await this.adb(['push', dumper, '/data/local/tmp/dumper.jar']);
    // 127.0.0.1:<port> on the phone is the QA API on the host (through adb, so it needs no network). The
    // network itself goes off: the app then reaches nothing else.
    await this.adb(['reverse', `tcp:${apiPort}`, `tcp:${apiPort}`]);
    await this.shell('svc wifi disable; svc data disable');
    // A first launch makes the app's storage table, which each screen then refills. Without it every screen would
    // fail, so an emulator whose app does not make it is left out (launched again once first).
    for (let launch = 0; launch < 2 && !(await this.hasStorage()); launch++) {
      await this.shell(`am force-stop ${PACKAGE}; monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);
      for (let i = 0; i < 40 && !(await this.hasStorage()); i++) await sleep(500);
    }
    await this.shell(`am force-stop ${PACKAGE}`);
    if (!(await this.hasStorage())) throw new Error(`${this.serial}: the app did not create its storage`);
  }

  /** Whether the app's storage table exists. Read-only, and only once the file has content: a plain sqlite3 would
   * create an empty root-owned file the app could then not open. */
  async hasStorage() {
    const answer = await this.shell(`[ -s ${STORAGE} ] && sqlite3 -readonly ${STORAGE} 'select count(*) from storage'`, { timeout: 15_000 }).catch(() => '');
    return /^\d+$/.test(answer.trim());
  }

  /** After a setup failed as a whole: whether this emulator still answers and the app's storage is there. */
  async healthy() {
    if (this.exited !== undefined) return false;
    const booted = (await this.shell('getprop sys.boot_completed', { timeout: 15_000 }).catch(() => '')).trim() === '1';
    return booted && this.hasStorage();
  }

  async applySetup(setup) {
    const scale = setup.reducedMotion ? '0' : '1';
    await this.shell([
      `wm size ${setup.width}x${setup.height}`,
      `wm density ${setup.density}`,
      `settings put system font_scale ${setup.fontScale}`,
      `cmd uimode night ${setup.night ? 'yes' : 'no'}`,
      ...['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale'].map(key => `settings put global ${key} ${scale}`),
      `cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.${setup.nav}`,
    ].join(' && '));
    // Let SystemUI redraw its bars at the new size and mode, then read them until they fit the setup: a navigation
    // bar along the bottom, 48 dp for 3 buttons, 24 dp for gestures on a phone and 32 dp (the taskbar) on a screen
    // 600 dp and wider. Right after a change SystemUI can still report the old bar, or the old density's height; a
    // wrong bar would move every bar check, so a setup whose bars never fit fails (and is tried again). A large
    // screen with 3 buttons (none in the matrix yet) has a taskbar of its own height and would need adding here.
    await sleep(2500);
    const fits = ({ statusBar, navigationBar }) => {
      if (!statusBar || !navigationBar || navigationBar[3] !== setup.height || navigationBar[2] !== setup.width) return false;
      const height = (navigationBar[3] - navigationBar[1]) * 160 / setup.density;
      const expected = setup.nav === 'threebutton' ? 48 : Math.min(setup.dp.width, setup.dp.height) >= 600 ? 32 : 24;
      return Math.abs(height - expected) <= 1;
    };
    // Both bars must also read the same twice in a row: a fresh boot can report a status bar that is still changing.
    let previous = '';
    for (let read = 0; ; read++) {
      this.insets = await this.systemBars();
      const current = JSON.stringify(this.insets);
      if (fits(this.insets) && current === previous) break;
      previous = current;
      if (read >= 10) throw new Error(`system bars do not fit the setup: ${JSON.stringify(this.insets)}`);
      await sleep(1000);
    }
  }

  /** Where the status and navigation bars are, in pixels: [left, top, right, bottom]. */
  async systemBars() {
    const windows = await this.shell('dumpsys window');
    const frame = type => {
      const match = windows.match(new RegExp(`InsetsSource id=\\S+ type=${type} frame=\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\] visible=true`));
      return match ? match.slice(1, 5).map(Number) : null;
    };
    return { statusBar: frame('statusBars'), navigationBar: frame('navigationBars') };
  }

  /** Fills the app's storage with `entries` (key → value), the app stopped. ADAPT: `entries` is whatever run.mjs
   * `storage()` returns: key → value here, or a SQL script for an app's own database. If your app stores its session
   * elsewhere (SharedPreferences, MMKV, DataStore), write that instead (see ENVIRONMENT.md). */
  async seedStorage(entries) {
    await this.shell(`am force-stop ${PACKAGE}`);
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    const sql = ['DELETE FROM storage;', ...Object.entries(entries).map(([key, value]) => `INSERT INTO storage VALUES(${quote(key)},${quote(value)});`)].join('\n');
    const file = join(process.env.TMPDIR, `seed-${this.port}.sql`);
    await writeFile(file, sql);
    await this.adb(['push', file, '/data/local/tmp/seed.sql']);
    await this.shell(`sqlite3 ${STORAGE} < /data/local/tmp/seed.sql`);
  }

  async open(path) {
    // ADAPT: your deep-link scheme.
    await this.shell(`am start -W -a android.intent.action.VIEW -d 'myapp://${path}' ${PACKAGE}`);
  }

  /** The app's UI dump. When the app's UI thread is too busy to answer, a dump can come back as a bare root: retried. */
  async dump() {
    let xml = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.shell(`rm -f /data/local/tmp/ui.xml; uiautomator runtest dumper.jar -c Dump -e out /data/local/tmp/ui.xml -e package ${PACKAGE}`);
      xml = await this.shell('cat /data/local/tmp/ui.xml');
      if ((xml.match(/<node /g) ?? []).length > 3) break;
      await sleep(500);
    }
    return xml;
  }

  async screenshot(file) {
    await writeFile(file, await this.adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }));
  }

  /**
   * Waits until one of `ready` shows and the labelled elements stop moving (two dumps alike), or `timeoutMs`.
   * Returns the last dump and whether it settled.
   */
  async settle(ready, timeoutMs = 25_000) {
    const until = Date.now() + timeoutMs;
    let previous = '', xml = '';
    await sleep(1200);
    for (;;) {
      xml = await this.dump().catch(() => '');
      const nodes = xml ? parseDump(xml).nodes : [];
      const found = !ready?.length || nodes.some(node => ready.some(text => matches(node, text)));
      const current = signature(nodes);
      if (found && current && current === previous) return { xml, settled: true };
      if (Date.now() > until) return { xml, settled: false };
      previous = found ? current : '';
      await sleep(400);
    }
  }

  /**
   * Swipes up until the page stops moving. Returns whether it moved (an element seen before and after changed
   * place), and the last dump, taken at rest.
   */
  async scrollToEnd(setup) {
    const x = Math.round(setup.width / 2), from = Math.round(setup.height * 0.75), to = Math.round(setup.height * 0.25);
    let xml = await this.dump(), moved = false;
    for (let i = 0; i < 6; i++) {
      for (let swipe = 0; swipe < 2; swipe++) await this.shell(`input swipe ${x} ${from} ${x} ${to} 150`);
      await sleep(800);
      const after = await this.dump();
      const shifted = displaced(parseDump(xml).nodes, parseDump(after).nodes);
      xml = after;
      if (!shifted) break;
      moved = true;
    }
    return { moved, xml };
  }
}

/**
 * Whether an element in both dumps is somewhere else in the second. Elements are matched by text and description;
 * a label shown more than once (two friends "not played yet") is compared as the list of its places.
 */
function displaced(before, after) {
  const places = nodes => {
    const map = new Map();
    for (const node of nodes) if (node.text || node.desc) {
      const key = `${node.text}|${node.desc}`;
      map.set(key, [...(map.get(key) ?? []), String(node.bounds)]);
    }
    return map;
  };
  const was = places(before), now = places(after);
  return [...now].some(([key, list]) => was.has(key) && was.get(key).length === list.length && was.get(key).join(';') !== list.join(';'));
}

/** What a player sees: texts and descriptions where they are (the logo's animated drawing is left out). */
const signature = nodes => nodes.filter(node => node.text || node.desc).map(node => `${node.text}|${node.desc}|${node.bounds}`).join('\n');
