#!/usr/bin/env node
// Template: copy into your repo without ".template" in the name, then change every line marked ADAPT.
// The device matrix: the app on headless Android emulators, every setup × screen photographed, dumped and checked.
// See README.md. Run through run.sh (it sets the SDK paths).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyze, thresholds } from './analyze.mjs';
import { Device } from './device.mjs';
import { columns, screens, setups as allSetups } from './matrix.mjs';
import { seed, startPostgres, startQaApi } from './qa.mjs'; // ADAPT: your test API (qa.template.mjs)
import { report } from './sheet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.DEVICE_MATRIX_HOME;
const apiPort = Number(process.env.DEVICE_MATRIX_API_PORT);
const { values: options } = parseArgs({ options: {
  apk: { type: 'string', default: join(home, 'build', 'app.apk') },
  emulators: { type: 'string', default: '3' }, // about 4 cores and 6 GB of RAM each
  setups: { type: 'string' }, // comma-separated ids from matrix.mjs
  screens: { type: 'string' },
  out: { type: 'string' },
} });

const pick = (list, ids) => ids ? ids.split(',').map(id => list.find(item => item.id === id) ?? fail(`unknown id ${id}`)) : list;
const fail = message => { throw new Error(message); };
const setups = pick(allSetups, options.setups);
const chosenScreens = pick(screens, options.screens);
const chosenColumns = columns.filter(column => chosenScreens.includes(column.screen));
const started = new Date();
const stamp = started.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const out = resolve(options.out ?? join(home, `run-${stamp}`));
const dumper = join(home, 'build', 'dumper.jar');
if (!existsSync(options.apk)) fail(`no APK at ${options.apk}: run build.sh first`);
if (!existsSync(dumper)) fail(`no ${dumper}: run dumper/build.sh first`);
await mkdir(join(out, 'shots'), { recursive: true });
const logLines = [];
const log = message => { const line = `${new Date().toISOString().slice(11, 19)} ${message}`; logLines.push(line); console.log(line); };

const apkInfo = Object.fromEntries((await readFile(`${options.apk}.txt`, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => line.split('=')));
log(`run ${out}: ${setups.length} setups × ${chosenColumns.length} columns, APK ${apkInfo.commit ?? '?'}`);

let reporting = Promise.resolve();
// One report at a time (each emulator calls it when it finishes a setup).
const writeReport = () => reporting = reporting.catch(() => {}).then(async () => {
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  const run = { started: started.toISOString(), minutes, out, apk: apkInfo, image: process.env.DEVICE_MATRIX_IMAGE, thresholds };
  const grouped = await report(out, { run, setups, columns: chosenColumns, captures, failures });
  await writeFile(join(out, 'run.log'), logLines.join('\n'));
  return { grouped, minutes };
});

const devices = [];
const captures = [];
const failures = [];
let pg, api;
// Ctrl-C or a kill (or a hang-up) stops after the screen in progress; the finally below then stops the emulators,
// the QA API and its database and writes the report. A second signal exits at once. Whatever way node exits,
// the 'exit' handler kills what is still running (run.sh removes a database folder a hard exit leaves).
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (stopping) process.exit(130);
    stopping = true;
    log(`${signal}: stopping after the screen in progress`);
  });
}
process.on('exit', () => { devices.forEach(device => device.killNow()); api?.kill(); pg?.kill(); });

try {
  pg = await startPostgres(home);
  api = await startQaApi(resolve(here, '../../../backend') /* ADAPT: your backend folder, here <app>/../backend */, pg.url, apiPort, text => logLines.push(`[api] ${text.trim()}`));
  const seeded = await seed(api.base);
  log(`QA API seeded: today ${seeded.today}`);

  // What each account's phone stores: signed in, introduction seen, the reminder sheet declined (so it does not
  // cover the end page), and the how-to-play sheet already shown, except for the screen that photographs it.
  // ADAPT: the keys your app reads to know it is signed in and that its first-run sheets were seen.
  const storage = (screen) => {
    const account = seeded.accounts[screen.account];
    const entries = {
      'myapp-session': account.token,
      'myapp-account-known': '1',
      'myapp-onboarding': 'seen',
      'myapp-reminder-prompt': JSON.stringify({ dismissals: 3, lastDismissed: Date.now() }),
    };
    if (!screen.help) for (const date of seeded.dates) entries[`myapp-help:${account.userId}:${date}`] = 'shown';
    return entries;
  };

  const count = Math.max(1, Math.min(Number(options.emulators), setups.length));
  for (let i = 0; i < count; i++) devices.push(new Device(5560 + i * 2, log));
  // An emulator that fails to start is left out; the others share its setups.
  const booted = await Promise.allSettled(devices.map(async device => {
    try {
      await device.boot(process.env.DEVICE_MATRIX_AVD, join(out, `emulator-${device.port}.log`));
      await device.install(options.apk, dumper, apiPort);
    } catch (error) {
      await device.kill(); // its cores and memory go to the others
      throw error;
    }
    return device;
  }));
  booted.filter(result => result.status === 'rejected').forEach(result => log(`emulator failed: ${result.reason?.message}`));
  const ready = booted.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!ready.length) throw new Error('no emulator started');

  // Under load an adb command now and then fails for no lasting reason, so each step gets a second try.
  const twice = async (what, step) => {
    try { return await step(1); } catch (error) {
      log(`${what}: ${error.message.trim()} (trying again)`);
      return step(2);
    }
  };

  const capture = async (device, setup, screen) => {
    // The picture follows the dump that found the screen at rest, so both show the same moment. `atEnd`: the page
    // is as far down as it goes (swiped to its end, or it does not scroll), which decides some checks' severity.
    const record = async (bottom, atEnd, xml, settled) => {
      const name = `${setup.id}--${screen.id}${bottom ? '-bottom' : ''}`;
      const pngFile = join(out, 'shots', `${name}.png`);
      await device.screenshot(pngFile);
      await writeFile(join(out, 'shots', `${name}.xml`), xml);
      const result = { setup: setup.id, screen: screen.id, column: `${screen.id}${bottom ? '-bottom' : ''}`, bottom, atEnd, settled,
        png: `shots/${name}.png`, xml: `shots/${name}.xml`, bars: device.insets };
      return Object.assign(result, analyze({ xml, png: await readFile(pngFile), setup, bars: device.insets, screen, bottom: atEnd }));
    };
    // Kept apart until the screen is done, so a failed first try leaves nothing behind. A scrolled picture that
    // fails on the last try leaves the good first one, and its own failure.
    let missingBottom = null;
    const shots = await twice(`${setup.id} ${screen.id}`, async attempt => {
      missingBottom = null;
      await device.seedStorage(storage(screen));
      await device.open(screen.path);
      const { xml, settled } = await device.settle(screen.ready);
      // A screen still loading (a splash, an empty dump) is tried again before it is kept as it is.
      if (!settled && attempt === 1) throw new Error('did not settle');
      if (!settled) log(`${setup.id} ${screen.id}: did not settle`);
      const top = await record(false, !screen.scroll, xml, settled);
      if (!screen.scroll) return [top];
      let end;
      try {
        end = await device.scrollToEnd(setup);
      } catch (error) {
        if (attempt === 1) throw error;
        missingBottom = { setup: setup.id, screen: screen.id, column: `${screen.id}-bottom`, error: error.message.trim() };
        return [top];
      }
      if (!end.moved) {
        // It does not scroll: the first picture is also the page's end.
        top.atEnd = true;
        Object.assign(top, analyze({ xml, png: await readFile(join(out, top.png)), setup, bars: device.insets, screen, bottom: true }));
        return [top];
      }
      return [top, await record(true, true, end.xml, settled)];
    });
    return { shots, failed: missingBottom ? [missingBottom] : [] };
  };

  /**
   * One setup on one emulator. Its pictures and failures are kept apart until it is over, so a setup that is tried
   * again elsewhere leaves nothing twice. `whole`: it failed as a whole (its settings, two screens in a row, or the
   * emulator exited). A screen begun before a stop but finished after it is dropped: the database may be gone.
   */
  const runSetup = async (device, setup) => {
    const shots = [], failed = [];
    try {
      await twice(`${setup.id} settings`, () => device.applySetup(setup));
    } catch (error) {
      return { whole: `settings: ${error.message.trim()}`, shots, failed };
    }
    log(`${setup.id}: bars ${JSON.stringify(device.insets)}`);
    let inARow = 0;
    for (const screen of chosenScreens) {
      if (stopping) break;
      try {
        const result = await capture(device, setup, screen);
        if (stopping) break;
        shots.push(...result.shots);
        failed.push(...result.failed);
        inARow = 0;
      } catch (error) {
        log(`${setup.id} ${screen.id}: ${error.message.trim()}`);
        failed.push({ setup: setup.id, screen: screen.id, column: screen.id, error: error.message.trim() });
        // A hung or dead emulator would otherwise cost every screen two adb timeouts.
        if (++inARow >= 2 || device.exited !== undefined) return { whole: error.message.trim(), shots, failed };
      }
    }
    return { whole: null, shots, failed };
  };

  // Emulators take setups from one queue. A setup that fails as a whole is given once more, preferably to another
  // emulator (an emulator takes back its own failure only when nothing else is queued and it is the last one
  // working). An emulator retires after two different setups fail in a row, or one followed by a failed health check.
  // Emulators with nothing to do wait while others still run (or finish up), so a setup given back late is not lost.
  const queue = [...setups];
  const failedOn = new Map(), firstTry = new Map();
  const working = new Set(ready);
  let running = 0;
  const next = async device => {
    for (;;) {
      if (stopping) return null;
      let index = queue.findIndex(setup => failedOn.get(setup.id) !== device);
      if (index < 0 && working.size === 1 && working.has(device)) index = 0;
      if (index >= 0 && index < queue.length) { running++; return queue.splice(index, 1)[0]; }
      if (!running) return null;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  };
  // A setup's end: its pictures and failures, and on each screen it never tried, why.
  const finish = (setup, result) => {
    captures.push(...result.shots);
    failures.push(...result.failed);
    // A screen whose `ready` text never showed is kept for the sheet, but the run is not clean: its findings may be
    // those of a splash or an error screen.
    for (const shot of result.shots) if (!shot.settled && !shot.bottom) failures.push({ setup: setup.id, screen: shot.screen, column: shot.column, error: 'did not settle: its ready text never showed' });
    if (!result.whole) return;
    for (const screen of chosenScreens) {
      const covered = result.shots.some(c => c.screen === screen.id) || result.failed.some(f => f.screen === screen.id);
      if (!covered) failures.push({ setup: setup.id, screen: screen.id, column: screen.id, error: `not tried: ${result.whole}` });
    }
  };
  await Promise.all(ready.map(async device => {
    let lastFailed = null, inARow = 0;
    for (let setup = await next(device); setup; setup = await next(device)) {
      try {
        const result = await runSetup(device, setup);
        if (result.whole && !failedOn.has(setup.id) && !stopping) {
          failedOn.set(setup.id, device);
          firstTry.set(setup.id, result);
          queue.push(setup);
          log(`${setup.id}: failed on ${device.serial} (${result.whole}); it will be tried once more`);
        } else {
          firstTry.delete(setup.id);
          finish(setup, result);
          log(`${setup.id}: ${result.whole ? `failed again (${result.whole})` : 'done'}`);
          // After each setup, so a run that is stopped still leaves a sheet of what it captured.
          await writeReport().catch(error => log(`report: ${error.message}`));
        }
        // The same setup failing twice here says more about the setup than about this emulator.
        if (!result.whole) inARow = 0;
        else if (lastFailed !== setup.id) inARow++;
        lastFailed = result.whole ? setup.id : null;
        if (inARow >= 2 || (result.whole && !(await device.healthy()))) {
          working.delete(device);
          log(`${device.serial}: ${inARow >= 2 ? 'two setups failed in a row' : 'not answering properly'}; it takes no more setups`);
          await device.kill();
          return;
        }
      } finally {
        // Only now: until this emulator has finished up (report, health check), others wait for it.
        running--;
      }
    }
  }));
  // Setups given back that no emulator took again end with their first try.
  for (const [id, result] of firstTry) finish(setups.find(setup => setup.id === id), result);
} finally {
  await Promise.all(devices.map(device => device.kill()));
  await api?.stop();
  await pg?.stop();
}

// Every setup × screen ends as a picture or a failure: what a stop or a lack of emulators left out is listed too.
for (const setup of setups) {
  for (const screen of chosenScreens) {
    const done = captures.some(c => c.setup === setup.id && c.screen === screen.id) || failures.some(f => f.setup === setup.id && f.screen === screen.id);
    if (!done) failures.push({ setup: setup.id, screen: screen.id, column: screen.id, error: stopping ? 'run stopped' : 'no working emulator left' });
  }
}
const { grouped, minutes } = await writeReport();
const errors = grouped.filter(p => p.severity === 'error' && !p.everywhere).length;
log(`${captures.length} captures, ${failures.length} failed, ${grouped.length} problems (${errors} device-specific errors) in ${minutes} min`);
log(`sheet: ${join(out, 'index.html')}`);
await writeFile(join(out, 'run.log'), logLines.join('\n'));
// Failed captures make the run fail, so an agent does not read a partial sheet as a clean one. An explicit exit:
// embedded-postgres's own exit hook would otherwise end the process with 0.
process.exit(failures.length ? 1 : 0);
