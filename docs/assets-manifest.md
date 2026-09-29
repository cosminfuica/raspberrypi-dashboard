# Assets manifest

Assets A1 (brand mark) and A2 (social preview poster) from [design-improvement-plan.md](design-improvement-plan.md), section 3. Made on 2026-09-29 for t_355f1cb3. A3 and A4 are captures, not generated; they belong to t_00607910.

## A1. Brand mark

A solder-mask tile with the pin-1 chamfer. Inside it, a gold board outline with its own chamfer, four GPIO pads, the SoC left of centre, and two 45° traces: one from the SoC's top edge to pad 2, one from its right edge to pad 4. Everything is hand-built by `docs/images/src/mark/build.py`. Recraft was used only to explore ideas, as the plan says.

| File | Size | Bytes | Use |
|---|---|---|---|
| `docs/images/mark.svg` | viewBox 32 | 422 | README logo (R1), smooth edges. Also the 64 px mark on the poster. |
| `frontend/public/favicon.svg` | viewBox 32 | 458 | Tab icon, `crispEdges`: 0 anti-aliased pixels at 16 and 32 px (the plan allows 10). |
| `frontend/public/favicon-warn.svg` | viewBox 32 | 552 | M8 tab icon when the worst state is "check": LED `#ffb93e`, r 4.5, on a r 6 mask ring at (25, 25). |
| `frontend/public/favicon-bad.svg` | viewBox 32 | 552 | The same with LED `#ff5f55`, for "problem". |
| `frontend/public/icon.svg` | viewBox 512 | 492 | Full-bleed app icon. The art sits inside the 80 % safe circle (0 px outside). |
| `frontend/public/icon-192.png` | 192×192 | 1,050 | PWA icon, `any` and `maskable`. |
| `frontend/public/icon-512.png` | 512×512 | 2,231 | PWA icon, `any` and `maskable`. |
| `frontend/public/apple-touch-icon.png` | 180×180 | 1,161 | iOS home screen, opaque. |
| `docs/images/src/mark/header-mark.svg` | viewBox 24 | 459 | The header mark, pasted inline in `frontend/index.html` (`.brand-mark`, 24 px), in `currentColor`. |

The web set is installed in `frontend/public` (t_504745a8), where `index.html` and `manifest.webmanifest` name it. It replaced M8's interim favicons.

**Rebuild:** `python3 docs/images/src/mark/build.py [OUT]`. OUT defaults to `frontend/public`. It needs rsvg-convert and Pillow. It asserts the 16 px pixel count, the safe circle, the opaque touch icon, and that `index.html` carries the current `header-mark.svg`: after a geometry change, paste it over the `.brand-mark` svg.

**Known limit:** at 16 px the amber LED is close in hue to the gold. It reads by its shape, a solid dot on a dark ring. The red one reads by colour. The LED colours are fixed by DESIGN.md.

**Exploration:** 4 Recraft images, about $0.84: `recraft/v4.1/utility/pro/text-to-image` ×2 and `recraft/v4.1/pro/text-to-image` ×2. Parameters: `aspect_ratio 1:1`, `resolution 2k`, `output_format png`, `colors [217,179,93] [240,207,126]`, `background_color [11,23,18]`. Request ids: a5034407, 2063563a, 31d93d12, c33b9125.
- What I took from them: traces that leave the chip's side, so the SoC stays a clean square, and 45° runs that end on a pad.
- What I didn't take: hairline strokes, a castellated edge, and traces ending in mid-air. None of them survive 16 px.

Prompt, as in the plan:

> Minimal flat app icon. A single square tile of matte green-black solder mask with its top-left corner cut at 45 degrees. Inside it, a simplified single-board computer drawn in flat ENIG gold lines: a board outline with one chamfered corner, a row of four small square header pads along the top edge, one solid square chip left of centre, two short traces leaving the chip at 45 degrees toward the pads. Pixel-grid geometry, uniform 2-pixel strokes, no gradients, no shading, no text, no fruit, no logos, no rounded corners, readable at 16 pixels.

## A2. Social preview poster

| File | Size | Bytes | Use |
|---|---|---|---|
| `docs/images/social-preview.png` | 1280×640 | 853,127 | GitHub › Settings › General › Social preview. The owner uploads it by hand (R6). PNG, under 1 MB. |
| `docs/images/poster.webp` | 1280×640 | 43,188 | README footer (R5), shown at `width="640"`, so it is already the 2× image. Quality 80. |
| `docs/images/src/plate.png` | 1280×640 | 926,942 | Master: the background plate (generated, see below). |
| `docs/images/src/board.png` | 1373×1303 | 604,016 | Master: the real 3D board cut-out, with alpha. |
| `docs/images/src/social.html` | — | — | Master: the composition. |
| `docs/images/src/social.mjs` | — | — | Renders the poster, or re-captures the board. |

**Checks** (`social.mjs` exits 1 if either fails):
- The wordmark has 10.6:1 contrast against the brightest pixel behind it (the plan asks for at least 7:1). This is measured on the rendered card with the text hidden.
- All text sits inside the central 1200×560.

**Composition.** The board is centred in the left 55 %. The solid stack has 67 px margins at the top and bottom. The right side, all in Archivo Variable, has:
- the mark at 64 px;
- "pidash" at 700, 118 % width, 112 px, `#edf0e8`;
- the tagline at 500, 36 px, `#b3bfb6`;
- the label row at 600, 78 % width, 20 px, tracked 0.07em, `#8a9a90`. The plan says about 18 px; at 18 it was marginal at README width.

A left-to-right scrim over the plate (`rgb(7 17 13 / .62)` from 60 %) keeps the text side calm.

**Board.** Captured from the app, never drawn by a model:
- Source: a scratch copy of HEAD with M1 applied (`scene3d.js:301`, silver `#a3a9ab`, roughness 0.5).
- Capture: `?demo`, reduced motion (fully exploded, no sway), at 1440×900 @2x. Cropped to the alpha box plus 40 px.
- The faint outlines around the stack are the app's own NEO 5 case ghost lines (`scene3d.js:585`, `596`, opacity 0.16).
- Alpha was checked on light and dark backgrounds.
- To re-capture after M1 lands: run `node docs/images/src/social.mjs board http://127.0.0.1:5199/?demo` against a running frontend, then `node docs/images/src/social.mjs`.

**Plate.** `marketing-studio/image/flare`, request 722869fb, with `aspect_ratio 16:9`, `resolution 2k`, `quality high`. It came back at 2688×1520 and was centre-cropped to 2:1, then mirrored:

```sh
magick <raw>.png -gravity center -crop 2688x1344+0+0 +repage -resize 1280x640 -flop -strip docs/images/src/plate.png
```

The mirror matters. The prompt put the trace detail on the right, which is exactly where the text goes. Mirrored, the traces frame the board and the text side stays dark. Before the scrim, the wordmark contrast was 4.1:1 on this plate; with it, 10.6:1.

Prompt, as in the plan:

> Macro product photograph of a bare circuit board surface: matte green-black solder mask (#0b1712), faint copper traces visible under the mask routed only horizontally, vertically and at 45 degrees, a few small vias and flat ENIG gold pads clustered near the right and bottom edges. No components, no chips, no connectors, no text, no logos, no markings. Soft low-angle light from the upper left grazing the mask texture, shallow depth of field, the left two thirds dark and even with generous empty space for a product cut-out, calm, precise, premium.

**Rejected plates:**
- Flare d82971f7 (same prompt): its filled pad rows read as component footprints, and its corner highlight is brighter.
- Recraft `recraft/v4.1/pro/text-to-image` facbd48d (the plan's flat alternative, $0.21): it has the stock "node terminal" circuit look, its cream discs read as components, and flat vector clashes with the photographic board.

**Cost.** Recraft: 5 images at $0.21 each, $1.05. Flare: 2 images, billed per token. The API's estimate returns only the rate card, not a figure.

## For the next cards

- **t_504745a8 (done):**
  - The web set is in `frontend/public`, and the header mark is inline in `index.html` at 24 px. At 2× every edge of the mark lands on a whole device pixel.
  - No OG or Twitter tags (plan, section 3).
- **t_00607910:**
  - R1: `docs/images/mark.svg` at `width="88"`.
  - R5: `docs/images/poster.webp` at `width="640"`, with the alt text from the plan's A2.
  - R6: the owner uploads `docs/images/social-preview.png`.
  - There is no README banner. The plan decides against one (R8), although the card body asks for it.
