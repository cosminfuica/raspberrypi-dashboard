# README creative brief: pidash

The locked look for every README asset (banner, clip, feature media). A later run reads this first and reuses what
worked. Made with the readme-enhancer, higgsfield-api and brag skills.

## Evidence

- **Name:** pidash is "Pi" plus "dash", a dashboard: an instrument panel for one board. The project calls itself
  "Mission control for your Raspberry Pi 5".
- **Job in the user's world:** a technician's bench. The machine is opened up, a probe is clipped to each chip and
  wired to a readout, and the fan is set by hand like a thermostat dial.
- **Voice:** plain ("The sudoers rule, in plain words", old README), precise ("Truth first: every number comes from
  the contract with its unit", PRODUCT.md), quietly showy ("The owner explicitly asked for a showpiece", PRODUCT.md;
  "Light weight, so a changing number never shouts", DESIGN.md).
- **Existing brand:** DESIGN.md, "The Silkscreen": the page is drawn in the board's own manufacturing language.
  Solder-mask field `#07110d`, mask `#0b1712`, silkscreen `#edf0e8`, ENIG gold `#d9b35d` for controls only, LED green
  / amber / red `#45d983` / `#ffb93e` / `#ff5f55` for health only, a heated-metal ramp for temperature only. One
  typeface, Archivo. 45 and 90 degree routing everywhere. The mark is `docs/images/mark.svg`.
- **Visual references** (rendered into the art workspace as `refs/`):
  - `ref-1.jpg` from `docs/images/src/board.png` on the field colour: keep the exploded three-tier stack (blower,
    board, NVMe base) and its materials.
  - `ref-2.jpg` from `docs/images/src/plate.png`: keep the matte solder-mask grain and the thin copper traces ending in
    round gold vias.
  - `ref-3.jpg`, a capture of the in-browser demo (`?demo&healthy`, 1600x1000): keep the silkscreen callout boxes
    joined to parts by 45 degree leaders, and the single green LED on "Healthy".

## Directions considered

Previews: `z-image/turbo`, 21:9, 1k, text only, $0.015 each.

| | Direction | Medium | One-line pitch | Preview request |
|---|---|---|---|---|
| A | Paper service model | layered cut-paper relief, 1980s pop-up book | A paper Pi 5, pulled apart layer by layer. | `7f08a027` |
| B | The desk at night | low-key macro product photography | Your Pi 5 at midnight, still reporting in. | `7ea75bb1` |
| C | The fab drawing | screen-printed exploded-view drawing, 1980s hi-fi service manual | The Pi 5's own fab drawing, wired to live readings. | `ed1f21f9` |

**Picked: C** (the owner wasn't asked; the agent chose). Its metaphor is the project itself: the dashboard is drawn
in the board's manufacturing language, and its low-power view is a 2D assembly drawing with callouts. It is also the
one look an HTML-built clip can carry. The previews: A drifted to cream and brown paper with real boards on it; B was
moody but generic (any Pi tool fits it); C came back as a grey 3D render with pseudo-text, so the real art leans on
Flare with the reference images.

## Locked

- **Metaphor:** the Pi 5 in its Argon NEO 5 stack (blower above, NVMe base below) as its own exploded fabrication
  drawing, printed in silkscreen and ENIG gold on solder mask, its chips wired by 45 degree traces to empty callout
  pads, one LED lit.
- **Style string** (every Higgsfield prompt starts with it):
  > Screen-printed exploded-view assembly drawing, 1980s hi-fi service-manual style: silkscreen-white #edf0e8 and
  > ENIG-gold #d9b35d linework on matte dark-green solder mask #0b1712 #07110d, fine 45-degree copper traces ending in
  > round gold vias, flat even light, subtle solder-mask grain, wide empty margins
- **Light banner clause:** "printed on a pale silkscreen-white ground #edf0e8 in dark solder-mask green #0b1712 and
  ENIG-gold #b18a3e linework"
- **Palette:** `#07110d` field, `#0b1712` solder mask, `#edf0e8` silkscreen, `#d9b35d` ENIG gold, `#45d983` LED
  green. The product's own amber `#ffb93e` and red `#ff5f55` appear only where the UI shows a health state.
- **Typeface:** Archivo (OFL-1.1, Fontsource `archivo`): display 700 for the name, text 400 for the tagline. The
  project's only typeface (DESIGN.md: "Don't add a second typeface").
- **Motion (clip):** lines draw like routed traces, at 0, 45 or 90 degrees, and end on a pad; parts slide apart along
  one axis and stop without bounce, like an exploded view; callouts open top-down with a wipe, as the app opens them.
- **brag:** tone `polished`, freeform "quiet premium product film, drawn like the Pi's own service manual", palette
  as above.
- **Tagline:** "Mission control for your Raspberry Pi 5" (the project's own line).

## Asset log

### Logo

The project's own mark, `docs/images/mark.svg`, rendered to `logo.png` at 256 px. Nothing generated.

### Banner art, dark

`marketing-studio/image/flare`, 21:9, 2k, quality high, reference images `ref-1.jpg` and `ref-2.jpg`. Prompt: the style
string, then "No text, no letters, no numbers, no labels, no logos. An exploded isometric line drawing of a Raspberry
Pi 5 single-board computer in three tiers floating apart: a square blower fan on top, the circuit board with its
chips, ports and pin header in the middle, an NVMe SSD base plate below. Thin 45-degree leader traces run from the
main chips to small empty square callout pads. One tiny green LED dot #45d983 on the board." plus the composition
clause below.

| Round | Candidate | Prompt change | Slop score + tells | Hard fails | Verdict |
|---|---|---|---|---|---|
| 1 | c1 `7b241e14` | (initial: "composition weighted to the right third, subject vertically centered, the left half empty") | 1: wrong surface (the stack fills the height, so banner.py's 3.2:1 crop cuts the fan and the base) | none | rejected |
| 1 | c2 `623afd6c` | (initial) | 1: wrong surface (same crop; traces under the tagline) | none | rejected |
| 1 | c3 `2be844a9` | (initial) | 1: wrong surface | stray text (a pseudo-label by a chip, digits on the NVMe base) | rejected |
| 2 | c1 `e390ef2f` | composition only: "the whole exploded stack is small, fits inside the middle 60% of the frame height with empty solder mask above and below it, and sits in the right 40% of the frame; the left 55% of the frame is plain empty solder mask", round-1 c1 as reference image 1 | 1: wrong surface (the base still clipped) | none | rejected |
| 2 | c2 `d20b7a4c` | same | 0 | a pseudo-label on one chip, visible at 2k only | accepted after repair |
| 2 | c3 `0aec7a77` | same | 1: wrong surface (the base clipped) | none | rejected |

- **Repair, try 1:** `alibaba/qwen-image-3/edit` (`c1f0d932`, 2k, 21:9, prompt_extend off): "Remove the tiny letters
  printed on the small chip next to the gold pin header, leaving that chip a plain dark package. Keep everything else
  identical". Output 2016x864, softer, and at 2x zoom the label was still faintly there. Not used.
- **Repair, used:** OpenCV inpainting (TELEA, radius 4) of only the label's bright strokes inside the chip
  (x 1903-1968, y 541-570 of the 2688x1152 original), then the ground lifted by (+5, +1, +4) RGB so it matches the
  field `#07110d` (it measured `#02100a`). Kept as the clip's `drawing.webp` too.
- **Fit:** the stack spans rows 201-1041 of 1152, taller than a 3.2:1 window of that width. Kept rows 168-1101 and
  prepended 299 px of the art's own plain left mask, mirrored (the left 30% has a luminance std of 1.5), to get
  2987x933 (3.2:1), so banner.py crops nothing. Scaled to 1600 px, JPEG q4: `dark.jpg`.
- **Measured:** on-palette 0.96, left-half fill 0.0, subject centre (0.72, 0.52). Composed tagline contrast 13.0:1.

### Banner art, light

`marketing-studio/image/flare`, 21:9, 2k, quality high, reference images: the accepted `dark.jpg` (1) and `ref-1.jpg`.
Prompt: the style string plus the light clause, the same subject, and "the stack is small, fits inside the middle 60%
of the frame height ... sits in the right third of the frame; the left 60% of the frame is plain empty #edf0e8 with
no objects and no traces. Match the drawing, line weight and composition of reference image 1, inverted onto the
light ground".

| Round | Candidate | Prompt change | Slop score + tells | Hard fails | Verdict |
|---|---|---|---|---|---|
| 1 | c1 `950f8fef` | (initial) | 0 | none | passed, not picked (corner traces make it busier than c2) |
| 1 | c2 `dd78a8d3` | (initial) | 0 | none | accepted |
| 1 | c3 `b5684a5b` | (initial) | 1: wrong surface (the base clipped at 3.2:1) | none | rejected |

- Used as generated, scaled to 1600 px: `light.jpg`. Composed tagline contrast 8.9:1.
- **Composed:** `banner.py --name pidash --tagline "Mission control for your Raspberry Pi 5" --weight 700 --logo
  logo.png`, Archivo 700 and 400 embedded. Checked at 830 px in both themes.
- **Social preview:** skipped. At 2:1 this layout puts the subject under the tagline; the repo already has an
  on-brand `docs/images/social-preview.png` (docs/assets-manifest.md, A2) for Settings, Social preview.

### Clip (`demo.mp4`, `demo-poster.jpg`)

The full `/brag` workflow (not brag-slim), tone `polished`, landscape 1920x1080, 23.6 s, Hyperframes 0.8.105. Plan,
brief, composition and renders are in `brag-output/` (gitignored). Scenes: the drawing wires up with live readings;
health; fan; update; outro. The UI scenes play real frames from the in-browser demo (`?demo`, 1024x768 at 2x, clock
pinned to a calm moment of the demo's load model), under a lower-third and a "Demo data" tag. Music: bundled
`happy-beats-business-moves-vol-12` at 0.30; SFX: `ui/rollover2`, `impact/impactSoft_medium_001`, `ui/click2`,
`interface/bong_001`, `keyboard/keypress-*` (pre-mixed). Audio-reactive: the copper trace layer's opacity follows the
music's RMS. Beat locks: the fan scene arrives on 8.74 s, the name settles by 19.66 s; the hook's callouts on the beat
grid from 1.09 s.

| Round | Change | Findings | Verdict |
|---|---|---|---|
| 1 (lint) | first pass | ripples visible before their press (fromTo from-state applied at authoring); two `<img>` on one file; timed scene sections | fixed |
| 2 (check, snapshots at 830 px) | `immediateRender: false` on ripples, own file for the outro art, scenes as timeline layers | check passed; frames: terminal box far too tall (`white-space: pre` on the box), tagline orphaned "Pi 5", push-ins cut the health, fan and System headings, the pointer's path to Update... crossed Reboot... | fixed |
| 3 (check, snapshots) | `pre` on rows only, explicit tagline lines, push-in origins near the top, pointer from the left | check passed, 33/33 contrast; frames clean | draft |
| 4 (draft render, 1 fps sheet) | - | pacing matches the storyboard; incoming crossfades used `power2.inOut` (an ease-in on an entrance) | fixed |
| 5 (final) | velocity-matched crossfades (`power2.in` out, `power2.out` in) | check passed; `--quality high`, 24.4 MB; slop tells: none | accepted |

- **Poster:** the settled hook at 3.7 s, baked in as frame 0. README copy: CRF 22, AAC 128k, 6.4 MB (under GitHub's
  10 MB attachment limit on free plans). Loudness: bed about -27 dB mean, peaks -4.4 dB.

### Feature GIFs

Cut from `brag.mp4`, each opening on a 0.8 s hold of its settled frame and cropped to the UI (no lower-third, which
repeats the row's title). Rows 1 and 3 first came out at 5.1 and 4.8 MB at 800 px and 12 fps (the push-in changes
every pixel, so GIF frame differencing can't help); tighter windows at 640 px and 8 fps brought them under 2 MB. Row 2
was first a 2.9:1 strip at 800 px (1.85 MB), then re-cut to match the others.

| GIF | Window (s) | Hold at | Crop (x:y:w:h of 1920x1080) | Size |
|---|---|---|---|---|
| `feature-1.gif` | 5.35-7.5 | 7.9 | 0:0:1300:975 | 640x480, 8 fps, 1.7 MB |
| `feature-2.gif` | 9.2-13.15 | 13.0 | 0:0:1560:975 | 640x400, 8 fps, 1.8 MB |
| `feature-3.gif` | 14.4-18.0 | 18.3 | 560:0:1300:975 | 640x480, 8 fps, 1.9 MB |

First and last frames of each show the settled state (lit PMIC, 3,962 rpm, "Succeeded · exit code 0"), so the loops
don't jump.
