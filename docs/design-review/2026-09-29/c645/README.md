# t_c645c12e: before and after

These are the production builds of `cd0cee6` (before) and `wt/t_c645c12e` (after). They were captured in headless Chromium with in-browser demo data (`?demo`), reduced motion (for a fixed board pose) and SwiftShader WebGL. Before is on the left, after on the right.

| File | What changed |
|---|---|
| `375x812.webp` | Phone. The hostname fits (the padlock pad replaces the Sign in pad), and the verdict list is reserved from the first paint. |
| `768x1024.webp` | Tablet. The verdict band sits above a shorter stage, and the fan card has two columns. |
| `1024x768.webp` | Small laptop. The verdict and its reasons are above the fold (they weren't before). |
| `1440x900.webp` | Desktop. The verdict is the page's headline, the port shells are toned down and the Custom pad is honest. |
| `lowpower-stage-1440.webp` | The low-power 2D drawing as an assembly drawing. |
| `forced-1440.webp` | Windows High Contrast. The LEDs, swatches, scale bar and selected profile are visible. |

## Measured on the production build

| Check | Before | After |
|---|---|---|
| Verdict and its reasons above the fold (10 viewports) | 9/10 (1024×768 fails) | 10/10 |
| CLS at 375×812, 768, 1024×768, 1180, 1440 | 0.102, 0.003, 0.003, –, 0.017 | 0.013, 0.001, 0.002, 0.007, 0.005 |
| Lighthouse mobile: perf, a11y, BP, SEO | 28, 96, 100, 90 | 32, 100, 100, 100 |
| Lighthouse desktop: perf, a11y, BP, SEO | 54, 96, 100, 90 (the plan's baseline) | 56, 100, 100, 100 |
| axe (WCAG 2.2 AA plus best practice, 375 and 1440, motion on and reduced) | 1 critical | 0 |
| Form-field border contrast | 2.34:1 | 3.47:1 |
| First load from `pidash --mock` (gzip) | about 850 KB | about 302 KB: 212 KB of gzipped text plus the 90 KB woff2 |
| Largest 3D-build task at normal CPU | 647 ms | 183 ms |
| Near-white pixels in the 1440 stage | 2,184 | 889 |

**Notes on the table:**

- The Lighthouse runs are lab runs on SwiftShader. Compare them only with each other.
- The desktop "before" run crashed twice in SwiftShader (`Inspector.targetCrashed`), so that row uses the plan's recorded baseline.
- **First load** counts `index.html` 6 KB, the JS 42 KB, the CSS 12 KB, the 3D chunk 152 KB and the woff2 90 KB, each measured with curl. The xterm chunk (82 KB gzipped, 331 KB raw) loads only when the console opens.

**The scripts** are `.impeccable/review/2026-09-29/scripts/c645-*.mjs` (all run with `DIST=<build dir>`), with the setup in `README.txt` there: `c645-check.mjs` (fold, CLS, pile, axe, inputs, header, forced colors, title), `c645-extra.mjs` (background-tab title, pad focus ring, footer, entrance), `c645-drawing.mjs` (2D collisions), `c645-touch.mjs` and `c645-touch3.mjs` (hit areas), `c645-forced2.mjs` (underlines) and `c645-shots.mjs` (the screenshots).
