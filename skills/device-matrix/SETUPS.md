# Choosing setups

A setup is a pixel size and a density (dp = px × 160 / density), plus the settings people change. `wm size` and
`wm density` set the first two, so one emulator can become any phone.

## Where the sizes come from

Ask the developer where the app's analytics are. Product analytics such as PostHog record each session's screen width,
height and pixel ratio. Group the Android users by width in dp and take:

- the narrowest real widths (often 309–344 dp: phones with display size set to Large or Largest),
- the most common width (often 393 or 412 dp),
- the widest phones (432 dp and up),
- any foldable or tablet sizes that appear.

With no analytics yet, keep the setups in `scripts/matrix.template.mjs`. They came from a real app's Android players
and cover the usual range.

## Settings to cover

| Setting | Values | Why |
|---|---|---|
| Display size | Large and Largest on a common phone | it raises the density, so a 384 dp Galaxy becomes 339 dp |
| Font scale | 1.0, 1.3, 2.0 | 2.0 is Android's largest |
| Navigation | gestures, 3 buttons | the 3-button bar is 48 dp, twice the 24 dp gesture bar |
| Dark mode | on, on one setup | catches hard-coded colours |
| Animations | removed, on one setup | the system "remove animations" setting |
| Foldable | cover screen (344 × 882), inner screen (690 × 829) | very tall, then almost square |
| Tablet | 800 × 1280 | the navigation bar becomes a 32 dp taskbar |

Combine them. The reference matrix's worst bug, a screen's main button below the bottom of the screen, showed only
where a narrow screen, a large font and the 3-button bar met. Its 19 setups:

| id | dp | settings |
|---|---|---|
| zoom-339 | 339 × 734 | display size Large |
| zoom-339-font13 | 339 × 734 | display size Large, font 1.3, 3 buttons |
| zoom-largest-309 | 309 × 686 | display size Largest |
| 360x780 | 360 × 780 | 3 buttons |
| 360x800 | 360 × 800 | |
| 360x800-font2 | 360 × 800 | font 2.0, 3 buttons |
| 384x832 | 384 × 832 | |
| 384x853-font13 | 384 × 853 | font 1.3 |
| 393x873 | 393 × 873 | the most common size |
| 393x873-font13 | 393 × 873 | font 1.3 |
| 393x873-font2 | 393 × 873 | font 2.0 |
| 393x873-3button | 393 × 873 | 3 buttons |
| 393x873-dark | 393 × 873 | dark mode |
| 393x873-reduced | 393 × 873 | animations removed |
| 412x915 | 411 × 914 | 3 buttons |
| 432x960 | 432 × 960 | |
| foldable-cover-344 | 344 × 882 | |
| foldable-inner-690 | 690 × 829 | |
| tablet-800 | 800 × 1280 | |

Name setups by what they are (`360x800-font2`). Agents and people read the ids in every finding.

## Screens

List each screen once, with the account it needs. Mark `scroll: true` on pages that can scroll, so the matrix also
photographs the end of the page. A first-run sheet (an introduction, a how-to) that should be checked gets its own
screen, with its "already seen" flag left out of the storage.
