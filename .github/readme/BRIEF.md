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
