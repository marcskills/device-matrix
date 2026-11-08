# Device Matrix

An agent skill that runs your Android app on many emulated phones at once, screenshots every screen, and checks
each screenshot for layout bugs: buttons under the system bars, a main button you have to scroll to find, tap targets
too small, overlaps, cut-off letters, words broken across lines.

You get a contact sheet with one row per phone and a red box on every problem. Your agent gets a `summary.json`
where each problem lists the phones it shows on, so it can fix a bug and prove it's gone on every phone.

It found a hidden button on 6 of 19 phone setups in my app, after every other test had passed.
[The story and the method](ARTICLE_LINK).

## Install

Any agent (Claude Code, Codex, Cursor and others):

```bash
npx skills@latest add marcskills/device-matrix
```

Claude Code, as a plugin that updates itself:

```bash
/plugin marketplace add marcskills/device-matrix
/plugin install device-matrix@marcskills
```

Or paste this into your coding agent, in your app's folder:

```
Read github.com/marcskills/device-matrix and set up a Device Matrix for this app.
```

Then ask for `/device-matrix`, or just ask how your app looks on other phones.

## For agents

If a user pasted the prompt above: install the skill in `skills/device-matrix/` for your harness (or read it in
place), then follow `skills/device-matrix/SKILL.md` from Phase 1. Ask the user before the steps that need them:
which screens matter, which elements must be visible, and `sudo usermod -aG kvm <user>` if `/dev/kvm` is not writable.
Do not run the app's install scripts before reading them.

## What's inside

| File | What |
|---|---|
| [SKILL.md](skills/device-matrix/SKILL.md) | the five phases, each with a "done when" checklist |
| [SETUPS.md](skills/device-matrix/SETUPS.md) | choosing phone setups from your users' screen sizes |
| [ENVIRONMENT.md](skills/device-matrix/ENVIRONMENT.md) | release build, local test API, seeded accounts, signing in without a login screen |
| [CHECKS.md](skills/device-matrix/CHECKS.md) | what each check flags, and its known false positives |
| [scripts/](skills/device-matrix/scripts/) | the working matrix; `*.template.*` files hold the parts you adapt |
| [README.md](skills/device-matrix/README.md) | when to reach for it, prerequisites, common questions |

## Requirements

Android only, for now. Linux or macOS with KVM or hardware acceleration, and about 4 cores and 6 GB of RAM per
emulator. The scripts were taken from a production Expo app and tested on two other open-source Expo apps.

## License

MIT
