# docs/images/src/: image generators

Own file: score 10 (14 files, 3 subdirs, 8 scripts in Python and Node with separate prerequisites) and a distinct
domain: every output lands outside this directory, mostly as committed binaries nobody edits by hand.

## OVERVIEW

Scripts that draw or capture every brand, README and social image from the app's own material (board render, trace
field, mark, Archivo font). Each script's header comment is its usage and prerequisite list: read it before running.

## WHERE TO LOOK

| Output                           | Script                                          | Writes                                                              | Needs                                                                                                                           |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Favicons, PWA icons, header mark | `mark/build.py [OUT]`                           | `frontend/public/*`, `mark/header-mark.svg`, `docs/images/mark.svg` | rsvg-convert, Pillow                                                                                                            |
| README SVGs, social PNG          | `readme/assets.py [--only ...]`                 | `.github/readme/*.svg`, `.github/readme/social-preview.png`         | `npm ci` in frontend/ (Archivo), fontTools + brotli + Pillow, Chromium (`CHROME`) for the PNG                                   |
| Frames for tiles and clip        | `readme/capture.mjs <out> <scene\|all>`         | frames + `events.json` per scene                                    | a built dist served by `PIDASH_TOKEN=demo pidash --mock --port 18787`; the console scene also needs `PIDASH_CONSOLE=1` on 18788 |
| Bento tiles (animated WebP)      | `readme/tiles.mjs <frames> <out>`               | `tile-*.webp` (copies live in `.github/readme/`)                    | capture.mjs frames                                                                                                              |
| Demo clip and poster             | `readme/clip.mjs <frames> <out> [--brag <dir>]` | `demo.mp4`, `demo-poster.jpg`                                       | ffmpeg; without `--brag` the clip renders silent                                                                                |
| Screenshots, tour                | `readme.mjs shots [pi]` / `readme.mjs tour`     | `docs/images/{hero,services,fan-curve,low-power,phone,tour}.webp`   | `shots`: the real Pi (default `http://raspberrypi:8787`); ImageMagick; ffmpeg with libwebp for `tour`                           |
| Older social poster (A2)         | `social.mjs` / `social.mjs board [url]`         | `docs/images/social-preview.png`, `poster.webp` / `board.png` here  | frontend `npm ci`, ImageMagick                                                                                                  |

## CONVENTIONS

- Pipeline order: `mark/build.py` -> `readme/assets.py` (reads `docs/images/mark.svg` and `frontend/src/traces.svg`)
  -> `capture.mjs` -> `tiles.mjs` / `clip.mjs` (both import `readme/compose.mjs`).
- Node scripts resolve Playwright from the working directory (`createRequire(process.cwd())`), so run them from a
  scratch dir after `npm i --no-save playwright`; `readme.mjs` and `social.mjs` pin `playwright@1.63.0`.
- `capture.mjs`, `compose.mjs` default `CHROME` to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`: set
  `CHROME` on any other machine.
- Captures are deterministic: the page runs under Playwright's paused fake clock (`T0`) with reduced motion. A new
  scene stays a pure function of that clock, or tiles and clip drift between runs.
- Asset log: README media in `.github/readme/BRIEF.md` (locked look, one entry per round). `readme/brag-plan.md` is
  the clip's storyboard.

## ANTI-PATTERNS

- Never hand-edit an output: every file in `.github/readme/` except `BRIEF.md` is generated, and so are the
  `frontend/public/` icons.
- `mark/build.py` asserts that `frontend/index.html` contains `header-mark.svg` verbatim. After a geometry change,
  paste it over the `.brand-mark` svg and rerun; the script never edits index.html itself.
- `board.png` is only ever re-captured (`social.mjs board`). `plate.png` is the one generated master, a background
  plate with no board on it.

## NOTES

- Two social previews exist: `.github/readme/social-preview.png` is the current one to upload;
  `docs/images/social-preview.png` is the older A2.
