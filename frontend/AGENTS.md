# frontend/: the dashboard page

Own file: score 13 (40 tracked files; `util.js` imported by 9 modules; 78 exports) and a distinct domain: a
framework-free UI held to DESIGN.md.

## OVERVIEW

Vanilla ES modules built by Vite 8; three.js and xterm.js are lazy chunks; lucide icons; Archivo variable font.
No framework, no TypeScript.

## WHERE TO LOOK

| Task                                    | Location                                                                               | Notes                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot, state `S`, every section renderer | `src/main.js`                                                                          | `// ====` banners: auth :136, header/nav :343, verdict :509 (`STALE_S` :351: No contact after 20 s), sections :784-1762, render loop :1763, boot :1908     |
| REST and the live stream                | `src/net.js`                                                                           | `api()` sends `X-Pidash-CSRF: 1`; `connect()` runs `/api/ws`: stale after 5 s, backoff 1 s to 10 s                                                         |
| In-browser demo backend                 | `src/mock.js`                                                                          | `?demo`, plus `&hot &flaky &healthy &docker=off &fan=kernel &auth=off &outage=A-B`; no console                                                             |
| Formatting, DOM helpers, palette        | `src/util.js`                                                                          | `fmt.*`, `el`, `refs`, `esc`, `setText`, `syncList`, `RAMP`, `prefs`                                                                                       |
| Hero board                              | `src/stage.js`, `src/scene3d.js`, `src/board.js`                                       | 3D loaded on demand; 2D drawing with the 2D board switch or without WebGL; geometry in mm                                                                  |
| Fan card, curve editor                  | `src/fan.js`, `src/curve.js`                                                           | curve.js is pure maths, tested by `curve.test.js`                                                                                                          |
| Charts                                  | `src/charts.js`                                                                        | `Chart` (canvas); `setWake(wake)` (main.js:1800) ties redraws to the one rAF loop                                                                          |
| Console, System, Logs cards             | `src/console.js`, `src/system.js` (+ `apt.js`, tested by `apt.test.js`), `src/logs.js` | Logs follow every 2 s, only while the page is visible                                                                                                      |
| All CSS                                 | `src/style.css`                                                                        | Tokens in `:root`; breakpoints 1280/1100/900/700/420 + `pointer: coarse`; reduced motion :3472, forced colors :3483, low power `html[data-lowpower]` :3564 |

## CONVENTIONS

- DOM: the skeleton is static in `index.html`. JS finds nodes by `data-bind` (page-wide, `bind()`) and `data-ref` (per
  section, `refs(root)`), and builds markup with `el(html)`. Every server string goes through `esc()`: unit, process
  and container names are untrusted.
- Rendering: change `S`, add keys to `dirty`, call `wake()`; one rAF `frame()` runs `RENDER[k]` for each. A new
  section needs entries in `RENDER` and `SECTION_RENDERS` (main.js:1801, :1815). Hidden tabs get no frames, so
  `onMetrics` renders the verdict directly (main.js:1859).
- Feature cards are `createX({...})` factories wired in main.js with injected hooks (`requireAuth`, `privileged`,
  `toast`, `canChange`); `createStage(root, hooks)` takes its root positionally.
- Numbers only through `fmt.*`: "—" for null, `NB` (no-break space) before units, binary units KiB to TiB. `fmt` does
  not make the true minus DESIGN.md requires: replace `-` with `\u2212` yourself (main.js:1352). Captions are
  uppercased by CSS: wrap figures in `<b>` to keep "GiB".
- A busy button gets `aria-disabled`, never `disabled`, so it keeps focus. Error toasts are sticky with `role="alert"`;
  the others leave after 6 s.
- Continuous motion checks `prefs.animate` (off for reduced motion and with the 2D board switch on).
- Tests are plain `node:assert` scripts. A new `*.test.js` must be appended to the `test` script in package.json.
- `src/` and `scripts/` pass `prettier --check`; `.prettierignore` skips `index.html` and `public/`.

## ANTI-PATTERNS

- Never statically import `three`, `scene3d.js`, `@xterm/*` or `mock.js`: each is a lazy chunk that keeps first load light.
- Don't set `changeOrigin` in vite.config.js: the backend's WebSocket Origin check needs Origin and Host to match.
- Don't hand-edit `public/` icons or the `.brand-mark` SVG in index.html (docs/images/src/mark/build.py writes them and
  fails until they match), or `src/traces.svg` (`node scripts/traces.mjs > src/traces.svg`).
- Don't read layout per frame (stage.js:287), and don't queue a second rAF while one is pending (`frame()`).
- Don't auto-reconnect the console: a new connection is a new shell.
- DESIGN.md rules that break visibly: gold means pressable only (a gold status badge or an amber button is a bug); the
  heat ramp means temperature only, on the fixed 30-90 °C scale (`T_MIN`/`T_MAX`); LEDs mean health only. No shadows on
  the 2D page (dialogs only). Square sections with one pin-1 chamfer, never rounded. Archivo only (monospace only in
  console and logs). Lines at 0°, 45° or 90°. No backdrop blur on callouts.

## SYNC BY HAND

- `index.html` ids, `data-bind` and `data-ref` <-> main.js <-> selectors in `scripts/*.mjs` (`[data-bind=verdict]`,
  `.fingers a[aria-current]`).
- Section ids `fan cpu thermals power memory storage network services containers tailnet console system` <-> nav order
  (keys `1`-`0`, `-`, `=`) <-> `PART_OF_SECTION` (main.js:796).
- main.js `SERIES` and renderers read the API shape. `?demo` (navcheck, herocheck, phonecheck) runs on mock.js, so an
  API change needs mock.js too; actionscheck runs on the backend's `pidash --mock`.
- `util.js` `RAMP` <-> `style.css` `--ramp` (:63); `curve.js` `DEFAULT_CONSTRAINTS` <-> backend `fan.py` `CONSTRAINTS`.
- `curve.js` `nightState`/`validateNight` <-> backend `fan.py` `effective_profile`/`validate_night`.

## BROWSER CHECKS (Playwright, not a dependency, not in CI)

```bash
npm i --no-save playwright && npx playwright install chromium
node scripts/navcheck.mjs [url]                          # with npm run dev running
DIST=frontend/dist node frontend/scripts/herocheck.mjs   # from the repo root, after a build; serves dist itself
DIST=frontend/dist node frontend/scripts/phonecheck.mjs  # from the repo root, after a build; serves dist itself (port 5403)
node scripts/actionscheck.mjs [url] [token]              # build + pidash --mock, PIDASH_CONSOLE=1 (its header)
```
