# README creative brief: pidash

The locked look for every README asset (banner, clip, bento tiles, spec cards, buttons, rules, outro). A later run
reads this first and reuses what worked. Made with the readme-enhancer skill (template 6, launch page + bento) and
brag; the generators live in `docs/images/src/readme/`.

## Evidence

- **Name:** pidash is "Pi" plus "dash", a dashboard: the instrument panel in front of one board. The project's own
  line is "Mission control for your Raspberry Pi 5".
- **Job in the user's world:** the gauge cluster of a car, for one small computer. Each reading sits next to the part
  it comes from, one light says whether to worry, and the fan follows the curve you drew.
- **Voice:** plain ("Know what's wrong, and where, at a glance", the README), precise ("Truth first: every number
  comes from the contract with its unit", PRODUCT.md), confident ("The hardware is the hero", PRODUCT.md).
- **Existing brand:** DESIGN.md, "The Silkscreen": a solder-mask field `#07110d` with the app's own trace field under
  it (`frontend/src/traces.svg`), silkscreen text `#edf0e8` / `#b3bfb6` / `#8a9a90`, flat ENIG gold `#d9b35d` on
  controls only, LED green / amber / red `#45d983` / `#ffb93e` / `#ff5f55` on health only, the heated-metal ramp on
  temperatures only. Footprints are square with one 14 px chamfered pin-1 corner and a pin-1 dot; every drawn line
  runs at 0, 45 or 90 degrees. One typeface, Archivo, with the width axis doing the hierarchy. The mark is
  `docs/images/mark.svg`.
- **Visual references** (`/tmp/readme-art/refs/` during a run):
  - `docs/images/src/board.png`: the app's own exploded Pi 5 and NEO 5 stack (blower, board, NVMe base), captured
    from the 3D view with the case ghost lines turned off. Keep: the product exactly as the app draws it, never
    redrawn by a model.
  - The dashboard's home screen at 1440 px (`?demo&healthy`): keep the callout boxes, the leaders routed at 45
    degrees into the parts, and the one-line verdict with its LED.
  - The fan curve editor (`docs/images/fan-curve.webp`): keep the gold handles, the hatched failsafe keep-out and the
    heat-coloured "now" marker.

## Rejected looks

- **Round 1 (first README):** a Flare line drawing of the stack, "1980s hi-fi service-manual style", feature GIFs cut
  from the clip. Owner: "ugly, pixelated, it looks like stock images from 1990".
- **Round 2 (second README):** Flare "premium product photography" studio set with the real board composited into a
  pool of light, a polished brag clip with the UI in a small chamfered window, three UI-crop WebPs. Owner: "not a fan
  of those assets and the video". Read as: murky and dim (the studio grade swallowed the field), the UI too small to
  read inside the clip's window, and a look borrowed from a product launch rather than from the app itself.

Rules kept from both: no era or medium borrowed from somewhere else; the board is the app's own render; every raster
at 2x of its display size; animated WebP, never GIF; nothing a stock site would tag "technology".

## Directions (round 3)

No image model this time (the environment can't reach api.higgsfield.ai), so each direction is drawable from the
project's own material. Previews were built in HTML with the app's fonts and colours.

| | Direction | Family | One-line pitch |
|---|---|---|---|
| A | Pinned readings | product: the app's exploded board with its callouts routed at 45 degrees into the parts, the LED verdict beside the name | Every reading, pinned to the part it comes from. |
| B | The curve | diagram: the fan curve editor's plot as a datasheet figure (gold handles, hatched failsafe, heat-coloured now marker) | The fan follows the curve you drew. |
| C | The footprint | emblem: one chamfered footprint with BCM2712 printed on its outline, a reading at display size, the heat bar, one LED | One board, drawn in its own silkscreen. |

**Picked: A** (the agent chose; the owner wasn't available). It is the only one that shows what pidash does, and it
is the product's own render. B is one feature, C is a style. Swap test: an exploded Pi 5 in a NEO 5 with a blower
reading pinned to the blower fits no other project.

## Locked

- **Metaphor:** the app's own exploded Pi 5 and NEO 5 stack, with silkscreen callouts routed at 45 degrees into
  their parts, and the health LED.
- **Style string** (every composition starts from it; there are no model prompts in this round): pidash's own
  silkscreen: a flat green-black solder-mask field `#07110d` with the app's trace field at 9 %, the app's own exploded
  Pi 5 render, silkscreen callout boxes (`#edf0e8` on `#07110d` at 88 %) joined to their parts by 0/45/90 degree
  leaders ending in a hollow pad, flat ENIG gold `#d9b35d` only on things you can press, LED lenses only for health,
  the heat ramp only for temperatures, square footprints with one chamfered pin-1 corner, generous empty space.
- **Light clause:** ground `#edf0e8`, surfaces `#e4e9e1`, the trace field in `#0b1712` at 6 %, ink `#0b1712`, dim
  `#3d4a44`, faint `#5c6b63`, outlines `rgb(11 23 18 / 0.22)`, ghost-button text `#8a6a2a` (gold is too light on the
  pale ground for text; the gold pad keeps its ink text). The board is the same render; the UI inside a tile stays
  the app's dark page, framed by the light card.
- **Palette:** DESIGN.md's, unchanged: field `#07110d`, mask `#0b1712`, raised `#10201a`, silkscreen `#edf0e8`,
  dim `#b3bfb6`, faint `#8a9a90`, gold `#d9b35d` / bright `#f0cf7e` / ink `#1c1505`, LED green `#45d983`, amber
  `#ffb93e`, red `#ff5f55`. Amber and red appear only where the UI shows a health state.
- **Typeface:** Archivo (OFL-1.1), static instances cut from the app's variable font with fontTools: display 700 at
  width 116 (the app's headline width), medium 500 and text 400 at width 100, semibold 650 for pad text, label 600
  at width 78 (uppercase, 0.07em), light 300 at width 94 for big readings. JetBrains Mono 500 (OFL-1.1, the first
  named face in the app's `--mono` stack) for commands and logs. Every SVG embeds only the glyphs it uses, as
  `readme-display`, `readme-text`, `readme-medium`, `readme-semibold`, `readme-label`, `readme-light`, `readme-mono`.
- **Motion:** things enter the way the app draws them: a callout box opens top-down (a clip, never a fade), its
  leader draws in from the box to the part, the LED lights last; entrances ease out (`expo.out`), nothing scales from
  zero, text settles for at least 1.5 s before anything else moves; one camera move per scene at most, a slow turn
  of the board by a drag, never a spin; readings change the way the app changes them (the number swaps, nothing
  bounces). `prefers-reduced-motion` turns every animation off.
- **brag:** tone `polished`, freeform "a crisp instrument film: the real page full-bleed, one benefit line per scene,
  the board turning once, the UI big enough to read". Music: brag's bundled `vol-12` (steady and clean).
- **Tagline:** "Mission control for your Raspberry Pi 5" (the project's own line).
- **Logo:** the mark (`docs/images/mark.svg`) appears on the outro and contribute strips only; the banner carries
  the board and the name.

## Copy decisions

- **Description (47 words):** see README.md.
- **Feature tiles** (benefit titles, 6 words max): 1 Know what's wrong, and where; 2 Quieter or cooler, no reboot;
  3 Draw your own fan curve; 4 Quiet at night, by itself; 5 Updates and reboots from your phone; 6 Every service, one
  list, with logs; 7 A real shell, in the browser; 8 Readings only a Pi 5 has.
- **Spec cards:** Install, Requires, Runs on, Reads, Serves, Live data, Fan profiles, License. Each verified in the
  manifest, the installer or a run this session (see README.md and the asset log below).

## Asset log (round 3)

No image model: every asset is drawn by `docs/images/src/readme/assets.py` (SVG) or composed from captures of the
real page by `capture.mjs`, `tiles.mjs` and `clip.mjs`. "Round" below counts the reviews at README width (830 px, the
contact sheets in `/tmp/readme-art/` during the run) and what each one changed.

### Board master (`docs/images/src/board.png`)

The app's 3D view at 1440x900, device scale 2, `?demo&healthy`, under `prefers-reduced-motion` (fully exploded, no
sway), the header, nav, verdict, fan card, callouts, leaders, scale and the trace background removed with
`display: none` (a hidden parent doesn't hide the callouts: they set their own visibility once placed), and the
NEO 5 case ghost lines turned off by rewriting the built chunk's one `opacity:.16` to `0` on the way in. Three
azimuths were captured by scripted drags with no inertia (a zero-length move before the pointer lifts); the app's
own default angle (`az0`) was kept, the ones turned 70 px either way are in the scratch dir.

| Round | Candidate | Change | Verdict |
|---|---|---|---|
| 1 | az0, az1, az2, az-1, az-2 | (initial) | rejected: the callout values bled into the capture (visibility override) |
| 2 | az0, az1, az-1 | overlays removed with `display: none` | az0 accepted: the app's own angle, fan top-left, ports right; the others kept for later |

### Banner (`banner-dark.svg`, `banner-light.svg`)

1280x400, 221 KB each: the board as a 1200 px WebP (quality 90) inside the SVG, everything else vector, the fonts
embedded as subsets (`readme-display`, `readme-text`, `readme-medium`, `readme-label`). The entrance is CSS inside
the SVG: name and tagline rise (0-0.8 s), each callout opens top-down and its leader draws in (0.75-1.9 s), the LED
lights last (2.1 s); static renderers and `prefers-reduced-motion` show the finished state.

| Round | Change | Findings at 830 px | Verdict |
|---|---|---|---|
| 1 | board 420 px tall at the right, three callouts around it | the board taller than the banner, the SoC box over the tagline, the NVMe box cut at the edge, callout type 8 px | rejected |
| 2 | board 384 px wide at (800, 20), callouts top-left, mid-left, bottom-right, boxes 204x82 with 14/29/15 px type | reads; the SoC box still crowds the tagline | moved the SoC box up and right |
| 3 | pads measured on the trimmed render (its aspect is 1.04, not the 1.3 first assumed) | the fan pad sat on the rotor, the SoC pad on the lid's marking | pads moved to the housing's corner, the lid's lower-left corner and the SSD body below its label |
| 4 | - | the entrance plays as the app draws it; name 19:1 and tagline 11:1 on the dark field, 14:1 and 6.5:1 on the light ground | accepted |

### Spec cards, CTA pads, rules, outro, contribute

All vector, 0.5-20 KB each. Cards: a 400x250 footprint in a 432x270 transparent half-gutter, the label knocked out of
the top outline as the app prints part designators, values at 31-35 px (auto-fit to two lines), the sub-line at
19 px. Round 1 had 13 px labels and 17 px sub-lines, unreadable at a quarter of 830 px; round 2 (accepted) raised
them to 17 and 19 px and reflowed the longer values. The CTA pads are the app's gold pad and ghost pad at 48 px. The
strips sit 12 px below the SVG's top so their designators aren't clipped (round 1 clipped them).

### Social preview (`social-preview.png`)

1280x640, 279 KB: the banner's layout without callouts, the board at 540 px, no entrance (a still), screenshotted by
headless Chromium from a 900 px tall window and cropped (headless Chromium's viewport is shorter than its window).
Round 1 put the board under the tagline and left a white strip; round 2 (accepted) moved the board right and cropped.

### Captures of the page (`capture.mjs`)

The tiles and the clip show the real page: the built `frontend/dist` served by `pidash --mock` on port 18787, opened
with `?demo` (one problem, two to check) or `?demo&healthy`, signed in; the console scene uses a second instance with
`PIDASH_CONSOLE=1`, where Connect opens a real bash. The viewport is 1600x900 at device scale 1.2 (1920x1080 frames)
or a 390x844 phone at 2x. Playwright's clock is installed and paused, so timers, animation frames and `Date` move only
by the frame step: the demo's 1 Hz readings, its fan ramp and its 250 ms-per-line update log land on the same frames
every run, however long a frame takes to draw. `prefers-reduced-motion` keeps the 3D board fully exploded and still
(software WebGL takes seconds per animated frame; a scripted drag still turns it). Headless Chromium paints no
pointer, so every scene writes `events.json` (the pointer per frame, clicks, marks, element rectangles) and the
compositions draw one.

| Round | Change | Verdict |
|---|---|---|
| 1 | pointer resting at the viewport's corner, 30 fps | rejected: the corner is over the Max pad, so every frame carried a hover outline, and the glide to a pad crossed the fan card |
| 2 | pointer resting in the header's empty middle, 24 fps for the clip's scenes and 12 for the tiles' | the console and update scenes scrolled to the wrong card: the masonry re-measures after the first scroll | 
| 3 | a second `scrollIntoView` on the first frame; the console waits 9 s of real time for the real backend's sections | the clock still advanced with real time between frames, so the demo's simulation ran ahead during slow frames (uptime jumping, the fan readout swinging) |
| 4 | `clock.pauseAt` after install; shorter drags (the stage adds inertia per animation frame, and with the clock paused every frame counts) | accepted: Balanced at 0 rpm, the press, then 1,949, 3,117, 4,523 rpm with the SoC steady; the log streams a line every three frames |

### Bento tiles (`tiles.mjs`)

Each tile is an HTML page drawn as a pure function of time: the footprint card with its chamfered pin-1 corner, a
window onto the captured frames with the pointer and a click ripple drawn from `events.json`, and the benefit title
with one line under it (Archivo 700 at width 116, and 400). 10 fps, rendered at 1.6x (a 400 px tile is 640 px) with a
16 px transparent half-gutter, encoded with libwebp at quality 82. Every loop opens on its settled end state, which is
also its last frame, so a paused image shows the result and the loop doesn't jump. The light tiles frame the same
dark page in a light card: the app has no light theme.

| Tile | Source and crop (CSS px of the capture) | Loop |
|---|---|---|
| `tile-stack-1-2` (400x800) | hero: the verdict box and the board beside it, the PMIC's callout and chip included; fan: the card from its heading to the Performance pad | 1.2 s hold, then 0.9-7.4 s and 0.3-7.4 s |
| `tile-feature-3` | curve: the tabs and the plot, without the heading and the points table | 1.2 s hold, then 0.2-6.4 s |
| `tile-feature-4` | night: from the Custom pad down, the switch and its status line | 1.2 s hold, then 0.2-4.4 s |
| `tile-feature-5` | update-phone: the three actions, the confirm dialog over them, the reboot notice and the finished toast, in a phone-shaped window | 1.5 s hold, then 0.2-10.8 s |
| `tile-feature-6` | services: the unit column, the Logs button and the journal dialog over them | 1.2 s hold, then 0.2-6.8 s |
| `tile-feature-7` | console: the card, Connect, then `uptime` and `free -h` typed into the real shell | 1.2 s hold, then 0.2-7.8 s |
| `tile-feature-8` | thermals: the four readings with their heat bars, no pointer | 0-3.9 s |
| `tile-preview` (800x800) | home, curve, services, update: 4.2 s each with a 0.45 s crossfade, the screen's name top-left, a dot per screen top-right | 16.8 s |
| `tile-code` (800x400) | no capture: the Quick start command typed at 70 ms a key, then its five real output lines | 2 s hold, then typed |
| `tile-list` | no capture: nine things it reads, 0.32 s apart | 2.2 s hold, then the list |

| Round | Change | Verdict |
|---|---|---|
| 1 | title above the window, 30 px | rejected: a two-line title pushed the line under the window |
| 2 | window on top, title 25 px and line 15 px under it; crops tightened (curve to the plot, night to the Custom pad, services to the dialog, thermals from below its heading, the phone to the actions and the dialog) | accepted at 830 px: titles read at 17 px, lines at 10 px, the UI inside a window at 8-11 px, as the template's own sample |

### Clip (`demo.mp4`, `demo-poster.jpg`, `clip.mjs`)

brag's plan (`docs/images/src/readme/brag-plan.md`), composed by `clip.mjs`: 1920x1080, 24 fps, 22.5 s, H.264 CRF 21,
AAC 128k. Four scenes: the hero capture full-bleed with the line "Know what's wrong, and where." (0-7.5 s), the fan
capture with a 1.00-1.05 push-in on the fan card and "A quieter or cooler Pi, without a reboot." (7.5-13.5 s), the
update capture from its open dialog at 1.5x with "Updates, reboots and restarts from your phone, not SSH."
(13.5-19.5 s), and the outro laid out like the banner with `sudo ./install.sh` typed in and install.sh's own last
line (19.5-22.5 s). Lines rise 28 px with `expo.out` over a bottom scrim and hold for the whole scene; scenes dip
through the field (0.3 s out, 0.4 s in). Sound: brag's `vol-12` at 0.30 with a 0.6 s fade-in and a 1.5 s fade-out, a
`drop_001` under each line, a `click1` under each press, randomised `keypress-*` ticks under the typed command at
0.28, one `impactSoft_medium_000` under the name; `amix` without normalisation, then a limiter. The poster is the
settled hook at 5.8 s, baked in as frame 0.

| Round | Change | Verdict |
|---|---|---|
| 1 (dry run) | - | scenes 1 and 2 black: the three full-frame windows share an opaque background, so the later ones hid the earlier; scene 3 showed the Containers card (the update capture's wrong scroll); the outro's board ran off the right edge |
| 2 (dry run) | transparent windows, the board at 840 px from x=1030, the update scene recaptured with a second scroll | the structure plays: hook, press, log, typed outro; loudness mean -27 dB, peak -4.6 dB |
| 3 (final) | the clean captures (paused clock): the board turns a quarter, the fan climbs 0, 1,949, 3,117, 4,295 rpm, the log streams a line every three frames | accepted: 22.5 s, 3.3 MB, loudness mean -27 dB and peak -4.6 dB; the poster (211 KB) is the hook at 5.8 s with the PMIC lit, plus a drawn play mark |

### Sizes

Tiles 33-335 KB each (the stack 331 KB), the preview card 1.9 MB (16.8 s of the full page at 1216 px, under the
template's 3 MB), 20 files, 5.9 MB in all; the whole folder without the clip is 7.1 MB. Captured frames, the clip's work frames and the compositions stay in the scratch directory and
`brag-output/` (gitignored).
