// The run's outputs: summary.json for agents and index.html, a contact sheet of setups × screens with the
// findings drawn on each picture.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Groups the same finding (check, severity, screen column, element) across setups, so a problem reads once with the
 * setups that show it. `everywhere` marks one that every setup where the screen loaded shows, in its first picture
 * or its scrolled one: more likely a design choice than a device problem, and listed after the others. Only settled
 * captures count, on both sides (one that never settled may show a splash).
 */
export function problems(captures) {
  const loaded = new Map(), shown = new Map();
  const add = (map, key, setup) => map.set(key, (map.get(key) ?? new Set()).add(setup));
  const what = finding => finding.element ?? finding.detail.replace(/\d+/g, '#');
  const groups = new Map();
  for (const capture of captures) {
    if (capture.settled && !capture.bottom) add(loaded, capture.screen, capture.setup);
    for (const finding of capture.findings) {
      const key = `${finding.check}|${finding.severity}|${capture.column}|${what(finding)}`;
      const group = groups.get(key) ?? { check: finding.check, severity: finding.severity, screen: capture.screen, column: capture.column, element: what(finding), setups: [], examples: [] };
      if (!group.setups.includes(capture.setup)) group.setups.push(capture.setup);
      if (group.examples.length < 3) group.examples.push({ setup: capture.setup, detail: finding.detail, bounds: finding.bounds });
      groups.set(key, group);
      if (capture.settled) add(shown, `${finding.check}|${finding.severity}|${capture.screen}|${what(finding)}`, capture.setup);
    }
  }
  const everywhere = group => {
    const all = loaded.get(group.screen), seen = shown.get(`${group.check}|${group.severity}|${group.screen}|${group.element}`);
    return !!all && !!seen && [...all].every(setup => seen.has(setup));
  };
  const rank = { error: 0, warning: 1 };
  return [...groups.values()]
    .map(group => ({ ...group, everywhere: everywhere(group) }))
    .sort((a, b) => Number(a.everywhere) - Number(b.everywhere) || rank[a.severity] - rank[b.severity] || b.setups.length - a.setups.length);
}

export function sheet({ run, setups, columns, captures, failures = [], grouped }) {
  const capture = (setup, column) => captures.find(c => c.setup === setup.id && c.column === column.id);
  const cell = (setup, column) => {
    const shot = capture(setup, column);
    if (!shot) {
      // A failed screen leaves its scrolled column empty too; a failed scroll only that one (older runs: no `column`).
      const failure = failures.find(f => f.setup === setup.id && ((f.column ?? f.screen) === column.id || (column.bottom && (f.column ?? f.screen) === column.screen.id)));
      if (failure) return `<td class="empty failed">failed: ${escape(failure.error)}</td>`;
      return `<td class="empty">${column.bottom ? 'does not scroll' : 'not captured'}</td>`;
    }
    const boxes = shot.findings.filter(f => f.bounds).map(f => {
      const [l, t, r, b] = f.bounds;
      return `<i class="box ${f.severity}" title="${escape(`${f.check}: ${f.element ?? ''} ${f.detail}`)}" style="left:${(l / setup.dp.width) * 100}%;top:${(t / setup.dp.height) * 100}%;width:${((r - l) / setup.dp.width) * 100}%;height:${((b - t) / setup.dp.height) * 100}%"></i>`;
    }).join('');
    const errors = shot.findings.filter(f => f.severity === 'error').length, warnings = shot.findings.length - errors;
    const list = shot.findings.map(f => `<li class="${f.severity}"><b>${escape(f.check)}</b> ${escape(f.element ?? '')} <span>${escape(f.detail)}</span></li>`).join('');
    return `<td><a class="shot" href="${escape(shot.png)}" target="_blank"><img loading="lazy" src="${escape(shot.png)}" alt="">${boxes}</a>
      <div class="count">${errors ? `<span class="error">${errors} errors</span>` : ''}${warnings ? `<span class="warning">${warnings} warnings</span>` : ''}${shot.settled ? '' : '<span class="error">did not settle</span>'}</div>
      ${list ? `<details><summary>findings</summary><ul>${list}</ul></details>` : ''}<a class="dump" href="${escape(shot.xml)}">ui dump</a></td>`;
  };
  const problemRows = grouped.map(p => `<tr class="${p.severity}${p.everywhere ? ' everywhere' : ''}"><td>${p.severity}</td><td>${escape(p.check)}</td><td>${escape(p.column)}</td><td>${escape(p.element)}</td>
    <td>${p.everywhere ? '<b>every setup</b>' : p.setups.map(escape).join(', ')}</td><td>${escape(p.examples[0].detail)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Device matrix ${escape(run.started)}</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;margin:16px;background:#faf9f6;color:#222}
h1{font-size:20px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 6px;vertical-align:top;text-align:left}
.problems tr.error td:first-child{color:#b00;font-weight:600}.problems tr.warning td:first-child{color:#a60}
.problems tr.everywhere{opacity:.6}
.grid th.setup{width:150px;font-weight:600}.grid th small{display:block;font-weight:400;color:#666}
.grid td{width:180px}.grid td.empty{color:#aaa;text-align:center;vertical-align:middle}.grid td.failed{color:#b00}
.shot{position:relative;display:block}.shot img{width:180px;display:block;border:1px solid #ccc}
.box{position:absolute;border:2px solid;box-sizing:border-box}.box.error{border-color:#e00;background:#f002}.box.warning{border-color:#e90;background:#fa01}
.count span{margin-right:6px;font-weight:600}.count .error{color:#b00}.count .warning{color:#a60}
li.error b{color:#b00}li.warning b{color:#a60}li span{color:#555}ul{padding-left:16px;margin:4px 0}
.dump{font-size:11px;color:#888}
</style>
<h1>Android device matrix</h1>
<p>Run ${escape(run.started)} · app ${escape(run.apk.commit?.slice(0, 7))}${run.apk.dirty === 'yes' ? ' (with uncommitted changes)' : ''} · ${escape(run.image)} · ${captures.length} captures in ${escape(run.minutes)} min ·
<a href="summary.json">summary.json</a>${failures.length ? ` · <b style="color:#b00">${failures.length} failed captures</b>` : ''}</p>
<p>Boxes: <b style="color:#e00">red</b> errors, <b style="color:#e90">orange</b> warnings. Faded rows show on every setup (likely design choices, not device problems).</p>
<h2>Problems (${grouped.length})</h2>
<table class="problems"><tr><th>severity</th><th>check</th><th>screen</th><th>element</th><th>setups</th><th>example</th></tr>${problemRows}</table>
<h2>Setups × screens</h2>
<table class="grid"><tr><th></th>${columns.map(c => `<th>${escape(c.label)}</th>`).join('')}</tr>
${setups.map(s => `<tr><th class="setup">${escape(s.id)}<small>${escape(s.label)}<br>${s.dp.width}×${s.dp.height} dp · ${s.width}×${s.height} px @${s.density}<br>font ${s.fontScale} · ${s.nav === 'threebutton' ? '3 buttons' : 'gestures'}${s.night ? ' · dark' : ''}${s.reducedMotion ? ' · no animations' : ''}</small></th>${columns.map(c => cell(s, c)).join('')}</tr>`).join('\n')}
</table></html>`;
}

/** Writes summary.json and index.html into `out`; returns the grouped problems. */
export async function report(out, { run, setups, columns, captures, failures }) {
  const order = (key, ids) => captures.sort((a, b) => ids.indexOf(a[key]) - ids.indexOf(b[key]));
  order('column', columns.map(c => c.id));
  order('setup', setups.map(s => s.id));
  const grouped = problems(captures);
  const summary = { run, setups, columns: columns.map(({ id, label }) => ({ id, label })), problems: grouped, failures, captures };
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  await writeFile(join(out, 'index.html'), sheet({ run, setups, columns, captures, failures, grouped }));
  return grouped;
}
