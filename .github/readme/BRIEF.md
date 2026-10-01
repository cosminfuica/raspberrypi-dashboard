# README creative brief: pidash

The locked look for every README asset (banner, clip, feature media). A later run reads this first and reuses what
worked. Made with the readme-enhancer, higgsfield-api and brag skills.

## Evidence

- **Name:** pidash is "Pi" plus "dash", a dashboard: an instrument panel for one board. The project calls itself
  "Mission control for your Raspberry Pi 5".
- **Job in the user's world:** the gauges in front of a driver. Every reading is pinned to the part it comes from, and
  one light says whether to worry.
- **Voice:** plain ("The sudoers rule, in plain words", old README), precise ("Truth first: every number comes from
  the contract with its unit", PRODUCT.md), quietly showy ("The owner explicitly asked for a showpiece", PRODUCT.md;
  "Light weight, so a changing number never shouts", DESIGN.md).
- **Existing brand:** DESIGN.md, "The Silkscreen": solder-mask field `#07110d`, mask `#0b1712`, silkscreen `#edf0e8`,
  ENIG gold `#d9b35d` for controls only, LED green / amber / red `#45d983` / `#ffb93e` / `#ff5f55` for health only.
  One typeface, Archivo, with a width axis (headlines at width 116). Depth belongs to the 3D centrepiece, an exploded
  Pi 5 and NEO 5 stack. The mark is `docs/images/mark.svg`.
- **Visual references:**
  - `docs/images/src/board.png`, the app's own 3D render of the stack (blower, board, NVMe base), its faint case
    outlines removed: keep the product exactly as the app draws it. It is composited into every asset, never redrawn.
  - A capture of the in-browser demo (`?demo`, 1024x768 at 2x): keep the callout boxes, the 45 degree leaders to the
    parts, and the one-line verdict.
  - Captures at the app's 600 px layout: each card stacks into one column there, which is what the 55 % feature column
    needs.

## Round 1, rejected

The first look was a Flare line drawing of the stack, "screen-printed exploded-view assembly drawing, 1980s hi-fi
service-manual style", with gold traces and vias in the banner's corners, and feature GIFs cut from the clip. The
owner's verdict: "ugly, pixelated, it looks like stock images from 1990". What caused it:

- The style string named an era and a drawn medium, so the art read as clip-art. The traces and vias are the
  circuit-board stock picture (slop tell 4), even though the scoring at the time passed them.
- The GIFs put a 1300 px crop of a 1080p frame into 640 px with 128 colours and a Bayer dither: text at about 8 px
  with a visible dither grid, at 8 fps.
- The banner art was a 1600 px JPEG, soft on a 2x screen, and the logo tile was the heaviest thing in it.

Rules taken from it: no era in the style string; the product is the app's own render, composited, never redrawn by
a model; every raster at 2x of its display size; no palette-limited formats; no decoration a stock site would tag
"technology".

## Directions (round 2)

Previews: `z-image/turbo`, 21:9, 1k, text only.

| | Direction | Medium | One-line pitch | Preview request |
|---|---|---|---|---|
| A | Studio | contemporary premium product photography, keynote launch style | Your Pi 5, lit like a flagship launch. | `0bc7a587` |
| B | Instrument | industrial-design studio model, machined aluminium and smoked acrylic | A machined instrument panel for one small computer. | `15cffa7c` |
| C | Readout | contemporary Swiss editorial poster, flat vector | The Pi's vital signs, set like a Swiss data poster. | `4a612c73` |

**Picked: A** (the agent chose; the owner had asked for a modern look). B's preview invented a product that doesn't
exist, a green aluminium box with LEDs. C came back as flat clip-art with the Raspberry Pi logo on the board. A had
the right light and mood, but its board was a generic AI board, so the art is an empty Flare studio with the app's
real render composited in.

## Locked

- **Metaphor:** the app's own exploded Pi 5 and NEO 5 stack (blower above, board, NVMe base below), floating in a
  pool of studio light like a flagship product.
- **Style string** (every Higgsfield prompt starts with it):
  > Contemporary premium product photography, keynote launch style: deep green-black seamless studio #07110d
  > #0b1712, one large soft overhead key light pooling on the right, gentle falloff into darkness, satin floor with
  > faint reflections, fine grain, crisp, minimal, generous empty space
- **Light banner clause:** swap the studio for "pale silkscreen-white seamless studio #edf0e8 with a faint green tint
  #dfe6dc" and the falloff for "gentle falloff into soft green-grey".
- **Subject rule:** Flare draws the set only: "an empty set with nothing in it: no objects, no products, no props, no
  furniture. A soft oval pool of light on the floor in the right third, ready for a product, with a faint horizon
  where the floor meets the back wall at mid-height. The left half is plain and dark. No text, no letters, no logos,
  no blue, no neon". The board goes in with a soft floor shadow, a 10 % reflection and a faint green light on the
  wall behind it.
- **Palette:** `#07110d` field, `#0b1712` solder mask, `#edf0e8` silkscreen, `#b3bfb6` silkscreen dim, `#45d983` LED
  green (the clip's "running" dot), `#d9b35d` gold (the clip's caret). Amber and red appear only where the UI shows
  a health state.
- **Typeface:** Archivo (OFL-1.1). Banner: display 700 at width 116 (the app's headline width) and text 400 at width
  100, both static instances cut from the variable font with fontTools. Clip: Archivo variable, plus JetBrains Mono
  500 (the first named face in the app's `--mono` stack) for the install line.
- **Motion (clip):** one slow push-in per scene at most; things enter rising 34-46 px with `expo.out`, nothing scales
  from zero; a reading's leader routes in from its part at 45 degrees and its box opens top-down, as the app draws
  them; blur crossfades between scenes, velocity-matched.
- **brag:** tone `polished`, freeform "quiet premium product film, lit like a keynote", palette as above.
- **Tagline:** "Mission control for your Raspberry Pi 5" (the project's own line).
- **Logo:** not drawn in the banner (round 1's gold tile outweighed the name). The mark stays the app's favicon and
  shows in the app header in the clip.

## Asset log

### Banner art, dark

`marketing-studio/image/flare`, 21:9, 2k, quality high. Prompt: the style string plus the subject rule.

| Round | Candidate | Prompt change | Slop score + tells | Hard fails | Verdict |
|---|---|---|---|---|---|
| 1 | c1 `965c137c` | (initial) | 0 | none | passed, not picked: a hard spotlight cone at the top edge pulls the eye |
| 1 | c2 `2a78fba1` | (initial) | 0 | none | passed, not picked: a bright floor patch between the name and the board |
| 1 | c3 `0e34f1dc` | (initial), plus the A preview as reference image 1: "match the colour, light and mood of reference image 1, but leave out its objects" | 0 | none | accepted |

- **Composite:** c3 cropped to 3.2:1 from the bottom (rows 312-1152 of 1152), scaled to 2560x800 (2x of the banner).
  Board at 80 % of the height, centred at (0.74, 0.50); floor shadow 55 %, reflection 10 %, grain sigma 1.1. JPEG
  q90 4:4:4, 207 KB.
- **Composed:** `banner.py --name pidash --tagline "Mission control for your Raspberry Pi 5" --weight 700`, the two
  Archivo instances embedded, no `--logo`. Worst-case contrast on the composed banner (brightest pixel under the
  text): name 19.6:1, tagline 11.9:1. Checked at 830 px and at 2x.

### Banner art, light

The same endpoint and subject rule, with the light clause; the accepted dark set (c3) as reference image 1: "Match
the composition, horizon and light of reference image 1, inverted onto the pale ground", and "the left 60% of the
frame is plain empty #edf0e8 with no objects".

| Round | Candidate | Prompt change | Slop score + tells | Hard fails | Verdict |
|---|---|---|---|---|---|
| 1 | c1 `dda785ee` | (initial) | 0 | none | passed, not picked: brighter pool, busier behind the board |
| 1 | c2 `3d27add0` | (initial) | 0 | none | passed, not picked: the left third goes grey behind the name |
| 1 | c3 `37ca621f` | (initial) | 0 | none | accepted |

- **Composite:** the same placement; shadow 30 %, reflection 8 %. Contrast: name 13.2:1, tagline 7.0:1.

### Social preview

The dark set again, composited at 2:1 with the board at 58 % of the height, centred at (0.80, 0.42) so it clears the
tagline (at 2:1, banner.py's tagline runs to 70 % of the width). banner.py at 1280x640 with square corners, drawn by
Chromium so the embedded fonts render: `social-preview.png`, 683 KB. It goes in Settings, Social preview; the README
doesn't use it.

### Clip (`demo.mp4`, `demo-poster.jpg`)

The full `/brag` workflow (not brag-slim), tone `polished`, landscape 1920x1080, 23.6 s, Hyperframes 0.8.105. The
round 1 storyboard, timing, music and SFX are kept; every visual is new. Composition and renders are in
`brag-output/` (gitignored).

- **Hook (0-4.0 s):** the studio set and the real board rising into the light; "Live readings, pinned to their
  parts." Four readings from the demo (blower, RAM, RP1, NVMe) route in at 45 degrees on the beat grid from 1.09 s.
- **Health, fan, update (4.0-18.9 s):** the in-browser demo's real frames (`?demo`, 1024x768 at 2x, clock pinned)
  in a chamfered window on the dimmed set, under a benefit line and a "Demo data" tag. The window rises in with the
  dissolve and its line follows 0.35 s later. Push-ins: 1.08 on health (it keeps the PMIC and RP1 boxes whole), 1.04
  on fan and update.
- **Outro (18.9-23.6 s):** laid out like the banner: the name, the tagline, `sudo ./install.sh` typed key by key and
  install.sh's own last line, beside the board.

| Round | Change | Findings | Verdict |
|---|---|---|---|
| 1 (lint) | drawing, traces and the music-reactive copper layer replaced by the studio set, the real board and chamfered windows | the studio image in 5 `<img>`, the board in 2 (duplicate media) | fixed: the studio as a CSS background, a separate file for the outro board |
| 2 (snapshots at 830 px) | - | the health push-in cut "GPIO" off the RP1 box; the NVMe leader's dot sat on the SSD's printed label | fixed: push-in 1.08 from (896, 437); dot on the SSD body |
| 3 (check, draft) | - | check passed, 33/33 contrast; pacing matches the storyboard, every beat holds long enough to read | high render |
| 4 (high render, 1:1 crops) | - | 8x8 blocking in the dark floor, from the studio background (lossy WebP, 42 KB) | fixed: lossless PNG with grain sigma 0.9 |
| 5 (check) | - | 7 layout warnings: in each dissolve between UI scenes the outgoing and incoming benefit lines overlap for about 0.1 s | fixed: each line enters 0.35 s after its window, once the outgoing scene is gone (the fan line lands on the 8.74 s cue) |
| 6 (final) | - | check passed with no warnings; `--quality high`; 1:1 crops of the dark floor show grain, not blocks; slop tells: none | accepted |

- **Poster:** the settled health beat at 7.9 s (the real dashboard under its benefit line), not the hook: the banner
  right above it already shows the board. Baked in as frame 0. `demo-poster.jpg` adds a play button, since the README
  shows it as a link to the clip until the clip is uploaded; the video's own frame 0 has none.
- **README copy:** CRF 22, AAC 128k, 5.9 MB (under GitHub's 10 MB attachment limit on free plans). Loudness:
  bed about -27.5 dB mean, peaks -4.8 dB.

### Feature media

Animated WebP, not GIF: GIF's 256 colours and dither are what made round 1 pixelated, and the old README already
used animated WebP (`docs/images/tour.webp`). Each row is its own small Hyperframes project (`brag-output/features/`):
the demo's real frames at 2x, the clip's pointer and press helpers, rendered losslessly as a PNG sequence at 20 fps
and encoded with libwebp (`-quality 90 -preset text`): rows 1 and 3 at 1040 px wide (about 2x of the 455-556 px the
wider column gets on GitHub), row 2 at its native 860 px (2x of its 430 px crop). Each
opens on its settled end state, which is also its last frame, so the loop doesn't jump and a paused image (GitHub's
"autoplay animated images" turned off) shows the result.

| File | Source | Crop (CSS px) | Length | Size |
|---|---|---|---|---|
| `feature-1.webp` | `?demo`, 1024x768 at 2x: Healthy, then 1 problem, then the pointer on the under-voltage reason, which lights the PMIC callout and its leader to the part | (24, 124) 736x588 | 6.0 s | 343 KB |
| `feature-2.webp` | `?demo&healthy`, 430 px phone layout at 2x, low power, signed in: Balanced at 0 rpm, a press on Performance, "Switching to Performance..." (0.1 s), Performance active (0.9 s), then readings of 3,225, 3,952 and 4,398 rpm (2.1, 3.4, 4.7 s), all at their real offsets from the click | (0, 100) 430x485 | 8.2 s | 277 KB |
| `feature-3.webp` | `?demo&healthy`, 600 px layout at 2x, low power, signed in: Update..., the confirm dialog, Update now, the log streaming, "Succeeded · exit code 0" | (0, 100) 600x600 | 8.4 s | 1.34 MB |

- Row 1 stays on the 1024 px layout: at 600 px the app lights the PMIC reading box under the board, and the part on
  the board doesn't visibly change.
- Row 2 uses the app's 430 px phone layout: the alternating table puts its media in the narrower column (about
  350 px on GitHub), where the 600 px layout drew body text at about 7 px; at 430 px it is about 10.5 px. The pointer
  rests in the pad's empty space, between its text and its curve glyph.
- Row 3 shows the demo's 7 s update in 3.2 s (every other log frame).
