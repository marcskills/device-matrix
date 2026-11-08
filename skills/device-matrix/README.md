## What it does

`device-matrix` runs an Android app on many emulated phones at once, screenshots every screen on each, and checks
every screenshot for layout bugs: elements under the system bars, a key button you have to scroll to find, tap
targets and grid cells too small, overlaps, letters cut off at the bottom, and words broken across two lines. It writes a contact sheet for you and a
`summary.json` for your agent.

The phones are not a generic list. They come from your own users' screen sizes, mixed with the settings people
change: display size, font scale, the 3-button bar. The bugs it finds live in those combinations.

## When to reach for it

Type `/device-matrix`, or the agent reaches for it when you ask how the app looks on other phones, when someone
reports a button or text missing on their phone, or when a layout fix needs proof.

| Situation | What to do |
|---|---|
| First time | Phases 1–3: setups, test environment, first run |
| Someone reports a layout bug | run it, find the setups that show it |
| Fixing a layout bug | before and after, one pull request per bug |
| Before a release | a full run on the release commit |

## Prerequisites

Linux or macOS with KVM or hardware acceleration, and about 4 cores and 6 GB of RAM per emulator (five in parallel
need about 20 cores). If the app has a backend, it must start in a test mode with seeded accounts. Root once, to grant
KVM.

## Every phone

The skill's done-condition is "gone on every phone". Each problem in `summary.json` lists the setups that show it,
and a fix counts when that list is empty in the after run and nothing new appeared. The agent proves its own fix,
and the pull request carries both contact sheets.

## Common questions

**Why not Firebase Test Lab or BrowserStack?**
They run real devices, which you need for bugs that only one brand has. They give you screenshots to look at. The
matrix gives you checks with numbers in dp, on your users' setups, that an agent can act on and re-run.

**Why not screenshot tests?**
They compare against a saved picture. If the saved picture already has the bug, they protect it.

**How long does a run take?**
19 setups × 8 screens took about 12 minutes on five emulators in the reference app. While fixing, run only the
setups and screens the bug shows on.

**Does it work for iOS?**
No. The iOS simulator and its UI tree need different tools.

## It's working if

- A bug report like "the button isn't there on my phone" turns into a list of setup ids within one run.
- Pull requests for layout fixes show a before and an after contact sheet.
- Problems marked `everywhere` get a decision from you, not a quiet fix from the agent.

## Where it fits

A reach-for-it-anytime standalone, and a step before any release that changes layout.
