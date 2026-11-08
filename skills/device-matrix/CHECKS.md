# The checks

`scripts/analyze.mjs` reads each screen's UI dump and screenshot and returns findings in dp, so they compare across
densities. "Elements" are texts, tappable elements and described leaf icons. Thresholds are in `thresholds` at the
top of the file.

| Check | Severity | Flags |
|---|---|---|
| `under-system-bar` | error, or warning on a scrolling page not yet at its end | an element at least 2 dp under the status or navigation bar. On a scrolling page the status bar only covers what has scrolled past, which is not flagged |
| `off-screen` | error | an element past a screen edge, or hidden while reaching outside the screen. Hidden elements inside the screen (an inactive tab's label) and ones parked wholly beside it (a closed drawer) are left alone, and so are elements under 2 dp |
| `below-the-fold` | warning | a `must` element behind the navigation bar or below the screen as a scrolling page opens: the player has to scroll to find it |
| `missing` | error | a `must` element not fully on screen and clear of the bars, after scrolling. Android clips bounds to the window, so a button pushed under the bar can come back as a thin sliver: it also counts as missing when its own text is not visible |
| `small-target` | warning | a tappable element under 48 dp either way (Android's minimum) |
| `overlap` | error | two tappable elements sharing at least 2 × 2 dp, neither inside the other |
| `small-grid-cell` | error, or warning | 4 or more same-size square tappable cells under 44 dp (error). On screens 600 dp and wider, a grid of 5 or more narrower than 60 % of the screen (warning) |
| `clipped-text` | error | the bottom of a letter cut off by its own text box, read from the screenshot |
| `broken-word` | error | a single word of 4 or more letters drawn on two lines, which Android does when a word doesn't fit its box, read from the screenshot |

## The system bars

The checks need the bars' real position. After applying a setup, `device.template.mjs` (`applySetup`) reads them
from `dumpsys window` (`InsetsSource … type=statusBars` and `type=navigationBars`) until the navigation bar runs
along the bottom at full width and has the height the mode gives: 48 dp for 3 buttons, 24 dp for gestures on a phone,
32 dp (the taskbar) on screens 600 dp and wider. Right after a change Android can report the old bar. A setup whose
bars never fit fails and is tried again.

## The UI dump

`uiautomator dump` waits for the app to go idle, and an app with a looping animation never does ("could not get idle
state"). `scripts/dumper/Dump.java` writes the same XML without waiting, for the app's own window only, with
`visible-to-user` on every node. `dumper/build.sh` builds it into `dumper.jar`.

The dump is Android's accessibility tree. An element with no text, no description and no click handler, such as a
decorative image, is invisible to the checks. Text shortened with "…" reads in full.

## clipped-text

The only check that reads pixels, because the dump reports a cut text as whole. It looks at texts with a descender
(g j p q y ç , ;), skipping text fields. It takes the background colour from the box's corners and reads the box's
bottom row. A cut stroke reaches that row at full strength, is about as wide as it is a few rows higher, and nothing
is drawn below the box. A letter that just ends there tapers off, a border is one long run, and a glyph drawn past the
box leaves ink below it, so none of those count. It only checks the bottom edge.

## broken-word

The dump reads a word whole even when Android draws it over two lines. The check counts the bands of ink down the
word's box: two bands at least 40 % as tall as the tallest mean two lines (an i's dot is not one). It skips boxes
under a system bar, where the bar's own drawing would read as a line, and boxes on a gradient (a fade over the end
of a page), where colour bands would.

## Known false positives

- Decorative text drawn at very low opacity (a large faded emoji or watermark) still counts as an element, so it can
  show as `under-system-bar` on every phone. Open the screenshot and leave it to the developer.
- `small-grid-cell` groups any 4 or more same-size square buttons, so scattered icon buttons (a header's icons and a
  column of steppers) can read as one grid. Open the screenshot: if there's no grid, the real finding is the
  `small-target` beside it.
- Problems that pass only at font 2.0 (buttons grow with the font) sort among the device-specific ones. Treat them as
  design choices.

## Grouping

`scripts/sheet.mjs` groups findings across setups by check, severity, screen column and element. A group is
`everywhere` when every setup where the screen settled shows it. The sheet fades those rows and lists them last.

## Adding a check

A check is a block in `analyze()` that reads the dump's nodes, the setup and the bars (and the screenshot, if it
needs pixels), and calls `add(check, severity, node, detail)`. Keep findings in dp, with a one-line `detail` that
names the measured value and the threshold, so an agent can act on it without opening the picture. Try it on saved
runs with `node reanalyze.mjs <run dir>` before running emulators.
