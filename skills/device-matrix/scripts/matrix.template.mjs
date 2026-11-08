// Template: copy into your repo without ".template" in the name, then change every line marked ADAPT.
// What the device matrix photographs: phone setups (rows) × app screens (columns).
// Sizes come from the reference app's Android players in PostHog (October 2026).
// A setup is a pixel size and a density (so dp = px × 160 / density, as `wm size` and `wm density` set them),
// plus the settings players change: font size, navigation mode, dark theme, and "remove animations".

const setup = (id, label, px, density, options = {}) => {
  const [width, height] = px.split('x').map(Number);
  return {
    id, label, width, height, density,
    dp: { width: Math.round(width * 160 / density), height: Math.round(height * 160 / density) },
    fontScale: options.fontScale ?? 1, nav: options.nav ?? 'gestural', night: options.night ?? false,
    reducedMotion: options.reducedMotion ?? false,
  };
};

// ADAPT: keep these setups until you have your own players' sizes, then replace them (see SETUPS.md).
export const setups = [
  // Galaxy A-series 1080×2340 (density 450) with display size set to Large: the narrowest players.
  setup('zoom-339', 'Galaxy, display size Large', '1080x2340', 510),
  setup('zoom-339-font13', 'Galaxy, display size Large, font 1.3, 3 buttons', '1080x2340', 510, { fontScale: 1.3, nav: 'threebutton' }),
  setup('zoom-largest-309', 'Display size Largest', '1080x2400', 560),
  setup('360x780', 'Small phone, 3 buttons', '720x1560', 320, { nav: 'threebutton' }),
  setup('360x800', 'Small phone', '1080x2400', 480),
  setup('360x800-font2', 'Small phone, font 2.0, 3 buttons', '1080x2400', 480, { fontScale: 2, nav: 'threebutton' }),
  setup('384x832', 'Galaxy default size', '1080x2340', 450),
  setup('384x853-font13', 'Galaxy, font 1.3', '1080x2400', 450, { fontScale: 1.3 }),
  setup('393x873', 'Most common size', '1080x2400', 440),
  setup('393x873-font13', 'Most common, font 1.3', '1080x2400', 440, { fontScale: 1.3 }),
  setup('393x873-font2', 'Most common, font 2.0', '1080x2400', 440, { fontScale: 2 }),
  setup('393x873-3button', 'Most common, 3 buttons', '1080x2400', 440, { nav: 'threebutton' }),
  setup('393x873-dark', 'Most common, dark theme', '1080x2400', 440, { night: true }),
  setup('393x873-reduced', 'Most common, remove animations', '1080x2400', 440, { reducedMotion: true }),
  setup('412x915', 'Pixel-size phone, 3 buttons', '1080x2400', 420, { nav: 'threebutton' }),
  setup('432x960', 'Wide phone', '1080x2400', 400),
  setup('foldable-cover-344', 'Foldable, cover screen', '904x2316', 420),
  setup('foldable-inner-690', 'Foldable, unfolded', '1812x2176', 420),
  setup('tablet-800', '10-inch tablet', '1600x2560', 320),
];

// Each screen opens with its own account's storage (qa.mjs seed) and a deep link.
// `ready`: text that shows the screen has loaded. `must`: text that has to end up fully on screen and clear of the
// system bars (after scrolling, for a scrolling screen). `help`: leave the how-to-play sheet's "already shown" flags
// out, so it opens by itself. `scroll`: also photograph the page swiped to its end, as `<id>-bottom`, when it scrolls.
// ADAPT: your screens. `account` names one of the accounts your seed() returns; `path` is a deep link;
// `ready` and `must` are texts as they appear on screen.
// `help` is the reference app's flag for its how-to-play sheet (run.mjs `storage`); drop it if you have no such sheet.
export const screens = [
  { id: 'home', label: 'Home (new board)', account: 'fresh', path: '/', ready: ['Submit'], must: ['Submit'] },
  { id: 'midgame', label: 'Game, half played', account: 'midgame', path: '/', ready: ['Submit'], must: ['Submit'] },
  { id: 'end', label: 'End page', account: 'player', path: '/', ready: ['Share'], scroll: true, must: ['Go to the archive'] },
  { id: 'archive', label: 'Archive', account: 'player', path: '/archive', ready: ['Archive'], scroll: true },
  { id: 'stats', label: 'Statistics', account: 'player', path: '/stats', ready: ['Your statistics'], scroll: true },
  { id: 'profile', label: 'Profile', account: 'player', path: '/profile', ready: ['Profile'], scroll: true },
  { id: 'settings', label: 'Settings', account: 'player', path: '/settings', ready: ['Settings'], scroll: true },
  { id: 'help', label: 'How-to-play sheet', account: 'fresh', path: '/', help: true, ready: ['Submit'], scroll: true },
];

/** The sheet's columns: each screen as it opens, then swiped to its end. */
export const columns = screens.flatMap(screen => [
  { id: screen.id, screen, bottom: false, label: screen.label },
  ...(screen.scroll ? [{ id: `${screen.id}-bottom`, screen, bottom: true, label: `${screen.label}, scrolled to the end` }] : []),
]);
