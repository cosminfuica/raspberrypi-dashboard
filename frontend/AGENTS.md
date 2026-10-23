# frontend/: the dashboard page

Own file: score 13 (106 tracked files; `ui/dom.js` imported by 22 modules; 123 exports) and a distinct domain: a
framework-free UI held to DESIGN.md.

## OVERVIEW

Vanilla ES modules built by Vite 8; three.js and xterm.js are lazy chunks; lucide icons; Archivo variable font.
No framework, no TypeScript.

## WHERE TO LOOK

| Task                                                  | Location                 | Notes                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot and wiring                                       | `src/main.js`            | `// ====` banners: auth :34, link state/nav :71, verdict :116, render loop :196, boot :287. Section factories called at :184-194                                                                                                                                                                                                                        |
| Page frame: state, render loop, sign-in, nav          | `src/shell/`             | `state.js` (`S`, History, `dataAge`), `loop.js` (`RENDER`, `dirty`, `wake`, `frame()`), `signin.js` (`canChange`, `requireAuth`), `feedback.js` (confirm, toasts), `header.js`, `nav.js`, `grid.js` (masonry)                                                                                                                                           |
| Link to the Pi                                        | `src/link/`              | `net.js`: `api()` sends `X-Pidash-CSRF: 1`; `connect()` runs `/api/ws`: stale after 5 s, backoff 1 s to 10 s. `series.js`: `SERIES`, same keys and order as backend app.py `SERIES` (`series.test.js` pins both to API.md). `api-examples.js`: `example(heading, n)`, node-only, imported by `*.test.js` and `scripts/herocheck.mjs`, never by the page |
| Health Verdict, Reasons, badge levels                 | `src/health/`            | `verdict.js`: `verdict()`, `levels`, `limitsOf`; `STALE_S` (No contact after 20 s). No DOM, no clock: `verdict-view.js` passes `now` and `ageS`. Tested by `verdict.test.js`. `verdict-view.js`: paints the Verdict, creates the Board, lights a Part                                                                                                   |
| Hero board                                            | `src/board/`             | `stage.js`, `scene3d.js`, `board.js`: 3D loaded on demand; 2D drawing with the 2D board switch or without WebGL; geometry in mm                                                                                                                                                                                                                         |
| One file per Section; which snapshot key redraws what | `src/sections/`          | `cpu.js`, `thermals.js`, `power.js`, `memory.js`, `storage.js`, `network.js`, `containers.js`, `tailnet.js`, `console.js`. `sections.js`: the Section table `RENDERS` (render, from, section, dim); `derive()` gives main.js `SECTION_RENDERS` and `DIM_ON_FAIL`                                                                                        |
| Fan card, curve editor                                | `src/sections/fan/`      | `fan.js`, `curve.js`: curve.js is pure maths (`validateCurve`, `pwmOf`, `preview`, `nightState`), tested by `curve.test.js`                                                                                                                                                                                                                             |
| System card, update job, reboot wait                  | `src/sections/system/`   | `system.js` (+ `apt.js`, tested by `apt.test.js`); `update-job.js` `createUpdateJob`, `reboot-watch.js` `watchReboot`: api, clock and timers injected, tested without real time                                                                                                                                                                         |
| Services, Logs                                        | `src/sections/services/` | `services.js` (table, restart, `canRestart`); `logs.js`: follow every 2 s, only while the page is visible                                                                                                                                                                                                                                               |
| In-browser demo backend                               | `src/demo/mock.js`       | `?demo`, plus `&hot &flaky &healthy &docker=off &fan=kernel &auth=off &outage=A-B`; no console                                                                                                                                                                                                                                                          |
| DOM helpers, palette, prefs, format, charts           | `src/ui/`                | `dom.js` (`el`, `refs`, `esc`, `setText`, `syncList`, `$`, `bind`), `palette.js` (`RAMP`, `heat`, `T_MIN`/`T_MAX`), `prefs.js` (`prefs`), `format.js` (`fmt.*`, `NB`; tested by `format.test.js`), `charts.js` (`Chart`; `setWake(wake)` (main.js:200) ties redraws to the one rAF loop)                                                                |
| All CSS                                               | `src/styles/index.css`   | Imports 31 parts in order; the order is the cascade. Tokens in `:root` (`tokens.css`); breakpoints 1280/1100/900/700/420 + `pointer: coarse` (`responsive.css`); reduced motion `modes.css:1`, forced colors `modes.css:12`, low power `html[data-lowpower]` `modes.css:93`                                                                             |

## CONVENTIONS

- DOM: the skeleton is static in `index.html`. JS finds nodes by `data-bind` (page-wide, `bind()`) and `data-ref` (per
  section, `refs(root)`), and builds markup with `el(html)`. Every server string goes through `esc()`: unit, process
  and container names are untrusted.
- Rendering: change `S`, add keys to `dirty`, call `wake()`; one rAF `frame()` runs `RENDER[k]` for each. A new
  Section is a `src/sections/<id>.js` `createX()` factory called by main.js, plus a `RENDER` entry (main.js:201) and a
  row in `src/sections/sections.js` `RENDERS`; `SECTION_RENDERS` is derived from it. Hidden tabs get no frames, so
  `onMetrics` renders the verdict directly (main.js:239).
- Feature cards are `createX({...})` factories wired in main.js with injected hooks (`requireAuth`, `privileged`,
  `toast`, `canChange`); `createStage(root, hooks)` takes its root positionally.
- Numbers only through `fmt.*`: "—" for null, `NB` (no-break space) before units, binary units KiB to TiB. `fmt` does
  not make the true minus DESIGN.md requires: replace `-` with `\u2212` yourself (sections/network.js:101). Captions are
  uppercased by CSS: wrap figures in `<b>` to keep "GiB".
- A busy button gets `aria-disabled`, never `disabled`, so it keeps focus. Error toasts are sticky with `role="alert"`;
  the others leave after 6 s.
- Continuous motion checks `prefs.animate` (off for reduced motion and with the 2D board switch on).
- New CSS goes in its owner's `src/styles/` part, never imported from JS (xterm's lazy CSS is the one exception).
- Tests are plain `node:assert` scripts. `npm test` runs every `*.test.js` under `src/` and reads the sibling backend
  (`../backend/tests/fan_vectors.json`, `../backend/tests/API.md`), so it needs the whole repo, not the frontend folder alone.
- A module with a `*.test.js` beside it, and everything it imports, touches no browser global at import, so node tests
  load it. `ui/palette.js` and `board/board.js` are pure too.
- `src/` and `scripts/` pass `prettier --check`; `.prettierignore` skips `index.html` and `public/`.

## ANTI-PATTERNS

- Never statically import `three`, `scene3d.js`, `@xterm/*` or `mock.js`: each is a lazy chunk that keeps first load light.
- Don't set `changeOrigin` in vite.config.js: the backend's WebSocket Origin check needs Origin and Host to match.
- Don't hand-edit `public/` icons or the `.brand-mark` SVG in index.html (docs/images/src/mark/build.py writes them and
  fails until they match), or `src/styles/traces.svg` (`node scripts/traces.mjs > src/styles/traces.svg`).
- Don't read layout per frame (stage.js:291), and don't queue a second rAF while one is pending (`frame()`).
- Don't auto-reconnect the console: a new connection is a new shell.
- DESIGN.md rules that break visibly: gold means pressable only (a gold status badge or an amber button is a bug); the
  heat ramp means temperature only, on the fixed 30-90 °C scale (`T_MIN`/`T_MAX`); LEDs mean health only. No shadows on
  the 2D page (dialogs only). Square sections with one pin-1 chamfer, never rounded. Archivo only (monospace only in
  console and logs). Lines at 0°, 45° or 90°. No backdrop blur on callouts.

## SYNC BY HAND

- `index.html` ids, `data-bind` and `data-ref` <-> main.js <-> selectors in `scripts/*.mjs` (`[data-bind=verdict]`,
  `.fingers a[aria-current]`).
- Section ids `fan cpu thermals power memory storage network services containers tailnet console system` <-> nav order
  (keys `1`-`0`, `-`, `=`). Section rows live in `src/sections/sections.js`; `sections.test.js` checks them against
  `data-part` and board.js `CALLOUTS`.
- Renderers read the API shape. `?demo` (navcheck, herocheck, phonecheck) runs on mock.js, so an
  API change needs mock.js too; actionscheck runs on the backend's `pidash --mock`.
- `ui/palette.js` `RAMP` <-> `styles/tokens.css` `--ramp` (:57).

## BROWSER CHECKS (Playwright, not a dependency, not in CI)

```bash
npm i --no-save playwright && npx playwright install chromium
node scripts/navcheck.mjs [url]                          # with npm run dev running
DIST=frontend/dist node frontend/scripts/herocheck.mjs   # from the repo root, after a build; serves dist itself
DIST=frontend/dist node frontend/scripts/phonecheck.mjs  # from the repo root, after a build; serves dist itself (port 5403)
node scripts/actionscheck.mjs [url] [token]              # build + pidash --mock, PIDASH_CONSOLE=1 (its header)
node scripts/snapcheck.mjs <base dist> <new dist>        # two builds give the same CSS, chunks, DOM, listener order and canvases
```
