#!/usr/bin/env node
// Runs the checks again on a finished run's dumps and pictures, and rewrites its summary.json and index.html:
// for trying a check or a threshold (analyze.mjs) without the emulators. Usage: node reanalyze.mjs <run dir>
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { analyze, thresholds } from './analyze.mjs';
import { columns, screens } from './matrix.mjs';
import { report } from './sheet.mjs';

const out = resolve(process.argv[2] ?? '');
const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
// Keep the run's first summary once, so a later check can be compared with what the run reported.
await writeFile(join(out, 'summary.orig.json'), JSON.stringify(summary), { flag: 'wx' }).catch(() => {});
for (const capture of summary.captures) {
  const setup = summary.setups.find(s => s.id === capture.setup);
  const screen = screens.find(s => s.id === capture.screen);
  const xml = await readFile(join(out, capture.xml), 'utf8');
  // `atEnd` (older runs: `bottom`) is whether the page was as far down as it goes.
  Object.assign(capture, analyze({ xml, png: await readFile(join(out, capture.png)), setup, bars: capture.bars, screen, bottom: capture.atEnd ?? capture.bottom }));
}
const ids = new Set(summary.columns.map(c => c.id));
const grouped = await report(out, { ...summary, run: { ...summary.run, thresholds }, columns: columns.filter(c => ids.has(c.id)) });
console.log(`${summary.captures.length} captures, ${grouped.length} problems: ${join(out, 'index.html')}`);
