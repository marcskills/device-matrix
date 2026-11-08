---
name: device-matrix
description: Run an Android app on many emulated phones and check every screenshot for layout bugs. Use when the user wants device or layout testing, asks how the app looks on other phones, reports a button or text missing on some phone, or needs to prove a layout fix on every phone.
---

# Device Matrix

A Device Matrix is a grid of **phone setups** (rows) × **screens** (columns). Each cell is a screenshot plus the
screen's UI dump, checked automatically. One run gives the developer a contact sheet with a red box on every problem,
and gives you `summary.json`, where each problem lists the setups that show it.

Its job is to answer "is this fixed on **every phone**?" with an empty list. A fix is done when its problem's
`setups` list is empty in the after run and no new problem appeared anywhere else.

The scripts in [scripts/](scripts/) are a working matrix taken from a production Expo app. Use them as they are. Files
named `*.template.*` hold the app-specific parts: copy them without `.template` and change each line marked `ADAPT`.
`sheet.mjs`, `reanalyze.mjs` and `dumper/` work for any Android app unchanged, and so does `analyze.mjs`, with one
habit: on the first run of a new app, open the screenshot of every device-specific error before believing it. A UI
kit can bring its own false positives. Fix them in `analyze.mjs` and check with `reanalyze.mjs` before Phase 4.

On a shared machine, run every matrix command under one lock from Phase 2 on
(`flock ~/device-matrix.lock scripts/device-matrix/run.sh …`): each run starts its own test API on the same ports.

Android only, on a Linux or macOS machine with KVM or hardware acceleration, about 4 cores and 6 GB of RAM per
emulator.

## Phase 1: Copy the players' phones

Read [SETUPS.md](SETUPS.md). Build the setup list from the screen sizes of the app's real Android users, and mix the
settings people change: display size, font scale, 3-button navigation.

Write the setups and the screens into `matrix.mjs` (from `scripts/matrix.template.mjs`). Each screen has an `account`,
a deep-link `path`, a `ready` text and its `must` elements: the texts a player has to be able to find, such as the
main button of the screen. Each is the whole text or accessibility label of one element, case aside, never a part
of it. To pick them, run one setup with every screen and read the texts in its `shots/*.xml`. Ask the developer which elements are `must` on each screen. That choice decides what the
matrix calls missing. With no developer to ask, take each screen's primary button and write the choice down.

Mark `scroll: true` on every page that could scroll on a small phone with a big font, even if it doesn't today. Then
a fix that makes a page scroll doesn't change the matrix between before and after.

Done when:

- [ ] Every setup comes from real users' sizes, or the developer agreed to the template's list for now.
- [ ] At least one setup combines a narrow screen, font 1.3 or more, and the 3-button bar.
- [ ] Every screen has a `ready` text, and the screens with a key action have `must` elements.

## Phase 2: Make a controlled environment

Read [ENVIRONMENT.md](ENVIRONMENT.md). The app under test is a release build of the current code that talks only to a
local test API with seeded accounts, with analytics and over-the-air updates off and the emulator's network cut. Each
screen opens signed in by writing a session token into the app's storage, because Google sign-in does not work on a
headless emulator.

Ask the developer to run `sudo usermod -aG kvm <user>` if `/dev/kvm` is not writable. It is the only step that needs
root.

Done when:

- [ ] `setup.sh` finishes with `ready: …`.
- [ ] `build.sh` prints the APK's path, and `<apk>.txt` records the commit.
- [ ] If the app has a backend: the test API starts, answers `/health`, and `seed()` returns a token for every account
      the screens name. With no backend, the no-backend path in ENVIRONMENT.md is in place.
- [ ] One screen opens signed in, with no first-run sheet on top: `run.sh --setups 393x873 --screens <one>` exits 0
      and its screenshot shows the screen.

## Phase 3: Run the matrix

```bash
scripts/device-matrix/run.sh --emulators 3                                    # all setups × screens
scripts/device-matrix/run.sh --setups 360x800-font2,zoom-339 --screens <id>   # part of it, while working
scripts/device-matrix/run.sh --build                                          # rebuild the APK first
```

Pick the number of emulators from the machine: about 4 cores and 6 GB of RAM each (the default is 3). The time grows
with the screenshots: 170 took 5 minutes on 3 emulators, 256 took 8.5 minutes on 3, and 195 took 12 minutes on 5
with a heavier app.

Each emulator takes setups from one queue. For each screen it writes the storage, opens the deep link and waits until
the screen has **settled**: its `ready` text shows and two UI dumps in a row agree. Then it takes the screenshot and
the dump. Scrolling pages get a second picture swiped to the end. 

A run exits 1 when any setup × screen failed or never settled. Read `failures` in `summary.json` before reading
`problems`. A partial run is not a clean one.

Done when:

- [ ] `run.sh` exited 0, or every entry in `failures` is explained and the developer accepted it.
- [ ] The contact sheet (`index.html`) and `summary.json` are in the run's folder.

## Phase 4: Read the findings

Read [CHECKS.md](CHECKS.md) for what each check flags and why. Start with `problems` where `everywhere` is false:
those show on some setups and not others, which points at a device problem. Problems with `everywhere: true` show on
every phone. They are more often a design choice. So is a problem missing only on the large-font setups: buttons
grow with the font, so a small target can pass at font 2.0 and still be a design choice. Show those to the developer and let them decide, rather than
fixing them.

When a check passes, make sure it had something to measure: a grid check passes when the screen has no grid.

To try a new check or threshold, edit `analyze.mjs` and run `node reanalyze.mjs <run dir>` on a finished run. It
rewrites the report without emulators.

Done when:

- [ ] Each device-specific problem is either a bug to fix or marked by the developer as accepted.

## Phase 5: Before and after

For each bug, one branch and one pull request:

1. Keep the full run on the current code as **before**. If the bug shows in the screenshots but no check flags it,
   add the check to `analyze.mjs` first and run `reanalyze.mjs` on the before run, so the bug has a `setups` list.
2. Fix the bug. While working, run only the setups and screens it shows on. Build the fix to its own file
   (`build.sh <out.apk>`, then `run.sh --apk <out.apk>`) so the before APK stays.
3. Run the full matrix on the fix as **after**.
4. Compare the two `problems` lists, with the same `matrix.mjs` in both runs. The fix is done when the bug's
   `setups` list is empty in after, after has no new error, and each new warning is a direct result of the fix (a
   `below-the-fold` on a page that now scrolls), named in the pull request.
5. Put both contact sheets and the before/after counts in the pull request.

Done when:

- [ ] The bug's `setups` list is empty in the after run.
- [ ] No new error in after, and every new warning is explained.
- [ ] The pull request shows before and after.

## Limits

- Emulators run Google's Android, without Samsung's or Xiaomi's changes on top. Brand-specific bugs need real devices.
- Text shortened with "…" reads in full in the UI dump, so it passes.
- It checks each screen once it has settled. Animations, gestures and flows between screens need other tests.
- Unlabelled icon buttons show as `Button`. Content cut by an overlapping header or parent is not detected.
- Horizontal scrollers are never swiped, so their hidden columns are not checked.
- The element names in `summary.json` double as a review of the accessibility labels: a label in the wrong language
  or a bare `Button` shows there.
