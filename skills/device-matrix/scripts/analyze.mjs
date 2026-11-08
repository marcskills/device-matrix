// The automatic checks: read a screen's UI dump (dumper/Dump.java) and its screenshot, and list what looks wrong.
// Everything is measured in dp, so findings compare across densities.
import { inflateSync } from 'node:zlib';

export const thresholds = {
  tapTarget: 48, // Android's minimum touch target, dp
  gridCell: 44, // smallest acceptable cell of a grid of tappable squares (a calendar's days), dp
  gridWidthShare: 0.6, // on a screen 600 dp or wider, a grid narrower than this share of the screen is flagged
  barOverlap: 2, // dp of an element under a system bar that count
  overlap: 2, // dp both ways that two tappable elements must share to count as overlapping
};

const attribute = (attributes, name) => {
  const match = attributes.match(new RegExp(` ${name}="([^"]*)"`));
  return match ? match[1].replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
};

/** The dump as a flat list of nodes with parent links; bounds in px as [left, top, right, bottom]. */
export function parseDump(xml) {
  const nodes = [];
  const stack = [];
  for (const match of xml.matchAll(/<node([^>]*)>|<\/node>/g)) {
    if (match[0] === '</node>') { stack.pop(); continue; }
    const a = match[1];
    const bounds = (attribute(a, 'bounds').match(/-?\d+/g) ?? [0, 0, 0, 0]).map(Number);
    const node = {
      id: nodes.length, parent: stack.at(-1) ?? null, text: attribute(a, 'text'), desc: attribute(a, 'content-desc'),
      cls: attribute(a, 'class'), clickable: attribute(a, 'clickable') === 'true', enabled: attribute(a, 'enabled') !== 'false',
      scrollable: attribute(a, 'scrollable') === 'true', visible: attribute(a, 'visible-to-user') !== 'false', bounds,
    };
    nodes.push(node);
    stack.push(node.id);
  }
  return { nodes };
}

// Screenshots are screencap's PNGs: 8-bit RGBA (or RGB), not interlaced.
export function decodePng(buffer) {
  let offset = 8, width = 0, height = 0, channels = 4;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0 || ![2, 6].includes(body[9])) throw new Error('unsupported PNG');
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, at: (x, y) => { const i = y * stride + x * channels; return [pixels[i], pixels[i + 1], pixels[i + 2]]; } };
}

/** Whether a node shows `text` (as its text or its description; case aside). */
export const matches = (node, text) => [node.text, node.desc].some(value => value.toLocaleLowerCase() === text.toLocaleLowerCase());
const area = ([l, t, r, b]) => Math.max(0, r - l) * Math.max(0, b - t);
const intersect = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
// Icon fonts draw glyphs from the Private Use Area, which read as nothing: name them by code point instead.
const label = node => (node.text || node.desc || node.cls.split('.').pop()).replace(/\s+/g, ' ')
  .replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFD}]/gu, c => `icon U+${c.codePointAt(0).toString(16).toUpperCase()}`).slice(0, 60);

/**
 * Checks one capture. `setup` gives the screen size and density, `bars` the system bars (device.mjs systemBars),
 * `screen` the matrix screen (its `must` list), `bottom` whether the page is as far down as it goes (swiped to its
 * end, or it does not scroll), and `png` the
 * screenshot (a Buffer) for the text-clipping check. Returns findings with bounds in dp.
 */
export function analyze({ xml, png, setup, bars, screen, bottom }) {
  const { nodes } = parseDump(xml);
  const dp = px => px * 160 / setup.density;
  const toDp = b => b.map(v => Math.round(dp(v)));
  const W = setup.width, H = setup.height;
  const findings = [];
  const add = (check, severity, node, detail, bounds = node?.bounds) => findings.push({
    check, severity, element: node ? label(node) : null, bounds: bounds ? toDp(bounds) : null, detail,
  });
  const ancestors = node => { const list = []; for (let p = node.parent; p !== null; p = nodes[p].parent) list.push(nodes[p]); return list; };
  const inScroller = node => ancestors(node).some(a => a.scrollable);
  const isAncestor = (a, b) => ancestors(b).includes(a);
  // What a player sees or taps: texts, tappable elements, and described leaves (icons). A described container
  // (React Native names some after their state, such as «busy») is only the space around them.
  const parents = new Set(nodes.map(n => n.parent));
  // at least 2 dp each way. A panel parked off-screen (a closed drawer) has bounds clipped to the window and,
  // depending on the density's rounding, keeps a 1 px sliver at the edge that would read as a device-specific bug.
  const big = ([l, t, r, b]) => dp(r - l) >= thresholds.barOverlap && dp(b - t) >= thresholds.barOverlap;
  const labelled = nodes.filter(n => (n.text || n.clickable || (n.desc && !parents.has(n.id))) && big(n.bounds) && area(n.bounds) < 0.8 * W * H);
  const image = png ? decodePng(png) : null;
  const visible = labelled.filter(n => n.visible);

  // 1. Under the status or navigation bar. A fixed element there is an error. In a scrolling page, the status bar
  //    only covers what has scrolled past, which is fine; the navigation bar covers what is still to come, a warning
  //    until the page has been swiped to its end and an error after (it can never come clear).
  for (const node of visible) {
    for (const [bar, frame] of [['status bar', bars.statusBar], ['navigation bar', bars.navigationBar]]) {
      if (!frame) continue;
      const shared = intersect(node.bounds, frame);
      if (shared[2] <= shared[0] || shared[3] <= shared[1] || dp(shared[3] - shared[1]) < thresholds.barOverlap) continue;
      const fixed = !inScroller(node);
      if (!fixed && bar === 'status bar') continue;
      add('under-system-bar', fixed || bottom ? 'error' : 'warning', node,
        `${Math.round(dp(shared[3] - shared[1]))} dp under the ${bar}${fixed ? '' : bottom ? ', with the page at its end' : ' (page not scrolled yet)'}`);
    }
  }

  // 2. Off screen: cut by a screen edge, or hidden (not visible to the user) outside any scrolling page.
  for (const node of labelled) {
    const [l, t, r, b] = node.bounds;
    // an element inside the screen that is not visible to the user is hidden on purpose (an inactive tab's
    // label, the other half of an icon cross-fade), not pushed off: only flag hidden elements that reach outside.
    const inside = l >= 0 && t >= 0 && r <= W && b <= H;
    if (!node.visible) {
      // wholly beside the screen is parked there on purpose (a closed drawer, another pager page).
      const parked = r <= 0 || l >= W;
      if (!inScroller(node) && !inside && !parked && (node.text || node.clickable)) add('off-screen', 'error', node, 'not visible on screen and not in a scrolling page');
      continue;
    }
    // past an edge, not touching it: a tab or list row drawn from x = 0 is not cut.
    const fullWidth = l <= 0 && r >= W;
    const edges = [l < 0 && !fullWidth && 'left', r > W && !fullWidth && 'right', b > H && (!inScroller(node) || bottom) && 'bottom', t < 0 && 'top'].filter(Boolean);
    if (edges.length) add('off-screen', 'error', node, `runs past the ${edges.join(' and ')} edge of the screen`);
  }

  // 3. Each `must` element: present, visible, whole, and clear of both bars (after scrolling, when the page scrolls).
  //    On a scrolling page's first view, one that is not clear yet is a warning: the player has to scroll to find it.
  // A `must` finding is named after its text whether or not the element was found, so it groups as one problem.
  const named = (text, node) => ({ text, desc: '', cls: '', bounds: node?.bounds });
  // Android clips a node's bounds to its window, so a button pushed under the navigation bar can come back as a
  // 3 dp sliver that ends exactly at the bar. Its text child then is not visible (or has inverted bounds): not clear.
  const cut = node => nodes.some(n => isAncestor(node, n) && (n.text || n.desc) && (!n.visible || n.bounds[3] <= n.bounds[1]));
  const clear = node => !((bars.navigationBar && node.bounds[3] > bars.navigationBar[1]) || (bars.statusBar && node.bounds[1] < bars.statusBar[3]) || cut(node));
  if (screen.scroll && !bottom) {
    for (const text of screen.must ?? []) {
      const node = visible.find(n => matches(n, text));
      if (!node || !clear(node)) add('below-the-fold', 'warning', named(text, node), `«${text}» is ${node ? 'partly behind the navigation bar' : 'below the screen'} as the page opens: only reachable by scrolling`);
    }
  }
  if (!screen.scroll || bottom) {
    for (const text of screen.must ?? []) {
      const node = visible.find(n => matches(n, text));
      if (!node) { add('missing', 'error', named(text, null), `«${text}» is not on screen${bottom ? ' even at the end of the page' : ''}`); continue; }
      if (!clear(node)) add('missing', 'error', named(text, node), `«${text}» is cut by a system bar or the screen's edge`);
    }
  }

  // 4. Tap targets smaller than 48 dp. Only whole targets: one cut by a scrolling page's edge is measured elsewhere.
  const tappable = visible.filter(n => n.clickable && n.enabled);
  for (const node of tappable) {
    const scroller = ancestors(node).find(a => a.scrollable);
    if (scroller && (node.bounds[1] <= scroller.bounds[1] || node.bounds[3] >= scroller.bounds[3])) continue;
    // A target inside another target of the same size is the same target.
    if (tappable.some(other => other !== node && isAncestor(other, node) && area(other.bounds) <= area(node.bounds) * 1.05)) continue;
    const w = dp(node.bounds[2] - node.bounds[0]), h = dp(node.bounds[3] - node.bounds[1]);
    if (w < thresholds.tapTarget || h < thresholds.tapTarget) add('small-target', 'warning', node, `${Math.round(w)}×${Math.round(h)} dp (minimum ${thresholds.tapTarget})`);
  }

  // 5. Tappable elements that overlap (neither inside the other).
  for (let i = 0; i < tappable.length; i++) {
    for (let j = i + 1; j < tappable.length; j++) {
      const a = tappable[i], b = tappable[j];
      if (isAncestor(a, b) || isAncestor(b, a)) continue;
      const shared = intersect(a.bounds, b.bounds);
      if (dp(shared[2] - shared[0]) >= thresholds.overlap && dp(shared[3] - shared[1]) >= thresholds.overlap) {
        add('overlap', 'error', a, `overlaps «${label(b)}» by ${Math.round(dp(shared[2] - shared[0]))}×${Math.round(dp(shared[3] - shared[1]))} dp`, shared);
      }
    }
  }

  // 6. Grids: four or more square-ish tappable elements of one size (a game board's tiles, a calendar's playable days).
  const grids = [];
  const pending = tappable.filter(n => { const w = n.bounds[2] - n.bounds[0], h = n.bounds[3] - n.bounds[1]; return h > 0 && w / h > 0.75 && w / h < 1.33; });
  while (pending.length) {
    const first = pending.shift();
    const size = [first.bounds[2] - first.bounds[0], first.bounds[3] - first.bounds[1]];
    const cells = [first, ...pending.filter(n => Math.abs(n.bounds[2] - n.bounds[0] - size[0]) <= 3 && Math.abs(n.bounds[3] - n.bounds[1] - size[1]) <= 3)];
    for (const cell of cells.slice(1)) pending.splice(pending.indexOf(cell), 1);
    if (cells.length < 4) continue;
    const span = [Math.min(...cells.map(c => c.bounds[0])), Math.min(...cells.map(c => c.bounds[1])), Math.max(...cells.map(c => c.bounds[2])), Math.max(...cells.map(c => c.bounds[3]))];
    // The grid's width is its cells' closest common container (a calendar month is wider than its playable days).
    const shared = ancestors(first).find(a => cells.every(cell => isAncestor(a, cell)));
    const outer = shared ? Math.max(shared.bounds[2] - shared.bounds[0], span[2] - span[0]) : span[2] - span[0];
    const grid = { cells: cells.length, cell: [Math.round(dp(size[0])), Math.round(dp(size[1]))], width: Math.round(dp(outer)), share: outer / W };
    grids.push(grid);
    // Named by its number of cells, so the same grid groups across setups (summary problems).
    const name = { text: '', desc: `grid of ${cells.length} cells`, cls: '', bounds: span };
    const example = `e.g. «${label(first)}»`;
    if (Math.min(...grid.cell) < thresholds.gridCell) add('small-grid-cell', 'error', name, `cells ${grid.cell[0]}×${grid.cell[1]} dp (minimum ${thresholds.gridCell}), ${example}`);
    if (dp(W) >= 600 && cells.length >= 5 && grid.share < thresholds.gridWidthShare) add('small-grid-cell', 'warning', name, `${grid.width} dp wide, ${Math.round(grid.share * 100)} % of a ${Math.round(dp(W))} dp screen (cells ${grid.cell[0]} dp), ${example}`);
  }

  // 7. Text cut at the bottom (descenders: Android cuts a line box shorter than the font's descent), from the
  //    picture. A cut stroke reaches the box's last row at full strength, carries on a few rows up, and nothing is
  //    drawn below the box. A glyph that just ends there tapers off; a border or underline is one long run; ink
  //    below the box is a glyph drawn past it. Only texts with a descender (a digit on a badge can sit right on its
  //    box's edge), and no text fields (their box ends at their underline).
  if (image) {
    for (const node of visible.filter(n => n.text && /[gjpqyç,;]/.test(n.text) && !/EditText/.test(n.cls))) {
      const [l, t, r, b] = node.bounds;
      // Partly scrolled out of its page (or under a bar): cut by the page's edge, not by its own box.
      const scroller = ancestors(node).find(a => a.scrollable);
      if (scroller && (t <= scroller.bounds[1] + 2 || b >= scroller.bounds[3] - 2)) continue;
      if ([bars.statusBar, bars.navigationBar].some(frame => frame && b > frame[1] && t < frame[3])) continue;
      const height = b - t, width = r - l;
      if (width < 6 || height < 8 || l < 0 || r > image.width || b > image.height - 4) continue;
      const corners = [[l, t], [r - 1, t], [l, b - 1], [r - 1, b - 1]].map(([x, y]) => image.at(x, y));
      const background = [...corners].sort((p, q) => corners.filter(c => distance(c, q) < 24).length - corners.filter(c => distance(c, p) < 24).length)[0];
      let strongest = 0;
      for (let y = t; y < b; y += 2) for (let x = l; x < r; x += 2) strongest = Math.max(strongest, distance(image.at(x, y), background));
      if (strongest < 150) continue;
      const strong = (x, y) => distance(image.at(x, y), background) > strongest * 0.75;
      const faint = (x, y) => distance(image.at(x, y), background) > 60;
      const depth = Math.max(2, Math.round(height * 0.06));
      // Runs of full-strength ink along a row, as [start, end).
      const runsAt = y => {
        const runs = [];
        let start = null;
        for (let x = l; x <= r; x++) {
          const on = x < r && strong(x, y);
          if (on && start === null) start = x;
          if (!on && start !== null) { runs.push([start, x]); start = null; }
        }
        return runs;
      };
      const upper = runsAt(b - 1 - depth);
      const widest = Math.max(6, height * 0.25);
      const bottom = runsAt(b - 1);
      const lines = bottom.filter(([x0, x1]) => x1 - x0 > widest);
      // A cut stroke is as wide at the edge as a little higher up; a serif foot (a serif font's p, q) is wider.
      const strokes = bottom.filter(([x0, x1]) => {
        const above = upper.filter(([u0, u1]) => u0 < x1 && u1 > x0);
        const aboveWidth = above.reduce((sum, [u0, u1]) => sum + (u1 - u0), 0);
        return x1 - x0 >= 2 && x1 - x0 <= widest && aboveWidth > 0 && x1 - x0 <= aboveWidth * 1.4;
      });
      const below = range(l, r).some(x => [b + 1, b + 2, b + 3].some(y => faint(x, y)));
      if (strokes.length && !lines.length && !below) add('clipped-text', 'error', node, `${strokes.length} stroke${strokes.length > 1 ? 's' : ''} cut at the bottom of the text's box (descenders)`);
    }
    // 8. A single word broken across lines (Android breaks a word that does not fit its box's width): the dump reads
    //    it whole, the picture shows two lines of ink. Words only (no space or hyphen, at least 4 letters); a line
    //    counts when it is at least 40 % as tall as the tallest, so an i's dot is not one.
    for (const node of visible.filter(n => /^\p{L}{4,}$/u.test(n.text) && !/EditText/.test(n.cls))) {
      const [l, t, r, b] = node.bounds;
      if (r - l < 6 || b - t < 8 || l < 0 || r > image.width || b > image.height) continue;
      // Under a bar, the bar's own drawing (the gesture handle) would read as a second line.
      if ([bars.statusBar, bars.navigationBar].some(frame => frame && b > frame[1] && t < frame[3])) continue;
      // On a gradient (a fade over the page's end), the colour bands would read as lines: only plain backgrounds.
      const corners = [[l, t], [r - 1, t], [l, b - 1], [r - 1, b - 1]].map(([x, y]) => image.at(x, y));
      if (corners.some(c => distance(c, corners[0]) > 24)) continue;
      const background = image.at(l, t);
      const ink = y => range(l, r).some(x => distance(image.at(x, y), background) > 120);
      const bands = [];
      let start = null;
      for (let y = t; y <= b; y++) {
        const on = y < b && ink(y);
        if (on && start === null) start = y;
        if (!on && start !== null) { bands.push(y - start); start = null; }
      }
      const tallest = Math.max(0, ...bands);
      const lines = bands.filter(h => h >= tallest * 0.4).length;
      if (lines >= 2) add('broken-word', 'error', node, `one word drawn on ${lines} lines in a ${Math.round(dp(r - l))} dp wide box`);
    }
  }

  return { findings, grids };
}

const distance = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
