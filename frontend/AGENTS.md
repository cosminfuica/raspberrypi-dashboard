# frontend/: the dashboard page

Own file: score 13 (30 files; `util.js` imported by 9 modules; 75 exports) and a distinct domain: a framework-free UI
held to DESIGN.md.

## OVERVIEW

Vanilla ES modules built by Vite 8; three.js and xterm.js are lazy chunks; lucide icons; Archivo variable font.
No framework, no TypeScript.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Boot, state `S`, every section renderer | `src/main.js` | `// ====` banners: auth :95, header/nav :284, verdict :443, sections :647-1340, render loop :1341, boot :1484 |
| REST and the live stream | `src/net.js` | `api()` sends `X-Pidash-CSRF: 1`; `connect()` runs `/api/ws`: stale after 5 s, backoff 1 s to 10 s |
| In-browser demo backend | `src/mock.js` | `?demo`, plus `&hot &flaky &healthy &docker=off &fan=kernel &auth=off &outage=A-B`; no console |
| Formatting, DOM helpers, palette | `src/util.js` | `fmt.*`, `el`, `refs`, `esc`, `setText`, `syncList`, `RAMP`, `prefs` |
| Hero board | `src/stage.js`, `src/scene3d.js`, `src/board.js` | 3D loaded on demand; 2D drawing with the 2D board switch or without WebGL; geometry in mm |
| Fan card, curve editor | `src/fan.js`, `src/curve.js` | curve.js is pure maths, tested by `curve.test.js` |
| Console, System, Logs cards | `src/console.js`, `src/system.js` (+ `apt.js`), `src/logs.js` | Logs follow every 2 s, only while the page is visible |
| All CSS | `src/style.css` | Tokens in `:root`; breakpoints 1280/1100/900/700/420 + `pointer: coarse`; reduced motion :3396, forced colors :3407, low power :3488 |

## CONVENTIONS

- DOM: the skeleton is static in `index.html`. JS finds nodes by `data-bind` (page-wide, `bind()`) and `data-ref` (per
  section, `refs(root)`), and builds markup with `el(html)`. Every server string goes through `esc()`: unit, process
  and container names are untrusted.
- Rendering: change `S`, add keys to `dirty`, call `wake()`; one rAF `frame()` runs `RENDER[k]` for each. A new
  section needs entries in `RENDER` and `SECTION_RENDERS` (main.js:1378, :1392). Hidden tabs get no frames, so
  `onMetrics` renders the verdict directly (main.js:1435).
- Feature cards are `createX({...})` factories wired in main.js with injected hooks (`requireAuth`, `privileged`,
  `toast`, `canChange`).
- Numbers only through `fmt.*`: "—" for null, `NB` (no-break space) before units, binary units KiB to TiB. `fmt` does
  not make the true minus DESIGN.md requires: replace `-` with `\u2212` yourself (main.js:1008). Captions are
  uppercased by CSS: wrap figures in `<b>` to keep "GiB".
- A busy button gets `aria-disabled`, never `disabled`, so it keeps focus. Error toasts are sticky with `role="alert"`;
  the others leave after 6 s.
- Continuous motion checks `prefs.animate` (off for reduced motion and with the 2D board switch on).
- Tests are plain `node:assert` scripts. A new `*.test.js` must be appended to the `test` script in package.json.

## ANTI-PATTERNS

- Never statically import `three`, `scene3d.js`, `@xterm/*` or `mock.js`: each is a lazy chunk that keeps first load light.
- Don't set `changeOrigin` in vite.config.js: the backend's WebSocket Origin check needs Origin and Host to match.
- Don't hand-edit `public/` icons or the `.brand-mark` SVG in index.html (docs/images/src/mark/build.py writes them and
  fails until they match), or `src/traces.svg` (`node scripts/traces.mjs > src/traces.svg`).
- Don't read layout per frame (stage.js:248), and don't queue a second rAF while one is pending (`frame()`).
- Don't auto-reconnect the console: a new connection is a new shell.
- DESIGN.md rules that break visibly: gold means pressable only (a gold status badge or an amber button is a bug); the
  heat ramp means temperature only, on the fixed 30-90 °C scale (`T_MIN`/`T_MAX`); LEDs mean health only. No shadows on
  the 2D page (dialogs only). Square sections with one pin-1 chamfer, never rounded. Archivo only (monospace only in
  console and logs). Lines at 0°, 45° or 90°. No backdrop blur on callouts.

## SYNC BY HAND

- `index.html` ids, `data-bind` and `data-ref` <-> main.js <-> selectors in `scripts/*.mjs` (`[data-bind=verdict]`,
  `.fingers a[aria-current]`).
- Section ids `fan cpu thermals power memory storage network services containers tailnet console system` <-> nav order
  (keys `1`-`0`, `-`, `=`) <-> `PART_OF_SECTION` (main.js:569).
- main.js `SERIES` and renderers read the API shape. `?demo` (navcheck, herocheck) runs on mock.js, so an API change
  needs mock.js too; actionscheck runs on the backend's `pidash --mock`.
- `util.js` `RAMP` <-> `style.css` `--ramp` (:62); `curve.js` `DEFAULT_CONSTRAINTS` <-> backend `fan.py` `CONSTRAINTS`.
- `curve.js` `nightState`/`validateNight` <-> backend `fan.py` `effective_profile`/`validate_night`.

## BROWSER CHECKS (Playwright, not a dependency, not in CI)

```bash
npm i --no-save playwright && npx playwright install chromium
node scripts/navcheck.mjs [url]                          # with npm run dev running
DIST=frontend/dist node frontend/scripts/herocheck.mjs   # from the repo root, after a build; serves dist itself
DIST=frontend/dist node frontend/scripts/phonecheck.mjs  # from the repo root, after a build; serves dist itself (port 5403)
node scripts/actionscheck.mjs [url] [token]              # build + pidash --mock, PIDASH_CONSOLE=1 (its header)
```
