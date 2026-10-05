#!/usr/bin/env python3
"""The README's static assets (.github/readme/BRIEF.md has the look; the README is the launch page + bento template of
the readme-enhancer skill). Writes into .github/readme/: the banner (dark and light, with the entrance the app draws
for its callouts), the CTA pads, the spec cards, the rules, the contribute card and the outro strip, and the SVG the
social preview is screenshotted from.

  python3 docs/images/src/readme/assets.py [--only banner spec ...] [--board docs/images/src/board.png]

Fonts are cut at run time from the app's Archivo variable font (frontend/node_modules, so run `npm ci` in frontend/
first) and from fonts/jetbrains-mono-latin-wght.woff2 (OFL-1.1, the latin subset Google Fonts serves), then subset
per file to the glyphs it uses, so each SVG stays small. Needs fontTools (with brotli) and Pillow: the backend venv
plus `pip install fonttools brotli pillow`.
"""
import argparse, base64, html, io, math, os, pathlib, re, shutil

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=str(ROOT / ".github/readme"))
ap.add_argument("--board", default=str(ROOT / "docs/images/src/board.png"), help="the app's board render, trimmed, on alpha")
ap.add_argument("--only", nargs="*", help="asset groups to build: banner social cta spec rule outro contribute")
A = ap.parse_args()
OUT = pathlib.Path(A.out)
OUT.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------ fonts
ARCHIVO = ROOT / "frontend/node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"
JBMONO = HERE / "fonts/jetbrains-mono-latin-wght.woff2"
INSTANCES = {  # family in the SVG: (source, axes). DESIGN.md's roles: display 700 at width 116, label 600 at width 78...
    "readme-display": (ARCHIVO, {"wght": 700, "wdth": 116}),
    "readme-medium": (ARCHIVO, {"wght": 500, "wdth": 100}),
    "readme-text": (ARCHIVO, {"wght": 400, "wdth": 100}),
    "readme-semibold": (ARCHIVO, {"wght": 650, "wdth": 100}),
    "readme-label": (ARCHIVO, {"wght": 600, "wdth": 78}),
    "readme-light": (ARCHIVO, {"wght": 300, "wdth": 94}),
    "readme-mono": (JBMONO, {"wght": 500}),
}
_inst = {}


def instance(fam):
    """The static instance as bytes (cut once), and its metrics."""
    if fam not in _inst:
        src, axes = INSTANCES[fam]
        f = TTFont(src)
        if "fvar" in f:
            f = instancer.instantiateVariableFont(f, axes, inplace=False)
        f.flavor = None
        buf = io.BytesIO()
        f.save(buf)
        f = TTFont(io.BytesIO(buf.getvalue()))
        _inst[fam] = (buf.getvalue(), f.getBestCmap(), f["hmtx"], f["head"].unitsPerEm)
    return _inst[fam]


def measure(s, fam, size, tracking=0.0):
    _, cmap, hmtx, upem = instance(fam)
    w = sum(hmtx[cmap.get(ord(c), cmap.get(63))][0] for c in s) * size / upem
    return w + tracking * size * max(0, len(s) - 1)


# ------------------------------------------------------------------ themes (DESIGN.md colours; the light clause is in BRIEF.md)
THEMES = {
    "dark": dict(field="#07110d", mask="#0b1712", raised="#10201a", ink="#edf0e8", dim="#b3bfb6", faint="#8a9a90",
                 line="rgb(237 240 232 / 0.16)", line2="rgb(237 240 232 / 0.3)", lead="rgb(237 240 232 / 0.62)",
                 gold="#d9b35d", goldhi="#f0cf7e", goldink="#1c1505", ok="#45d983", okdk="#1f6b40",
                 trace="#edf0e8", traceop="0.075", via="#07110d"),
    "light": dict(field="#edf0e8", mask="#e3e8df", raised="#d9dfd5", ink="#0b1712", dim="#3d4a44", faint="#5c6b63",
                  line="rgb(11 23 18 / 0.22)", line2="rgb(11 23 18 / 0.4)", lead="rgb(11 23 18 / 0.62)",
                  gold="#d9b35d", goldhi="#8a6a2a", goldink="#1c1505", ok="#45d983", okdk="#1f6b40",
                  trace="#0b1712", traceop="0.06", via="#edf0e8"),
}
TRACES = (ROOT / "frontend/src/traces.svg").read_text()
TRACE_PATH = re.search(r'<path d="([^"]+)"', TRACES).group(1)
TRACE_VIAS = re.findall(r'<circle cx="(\d+)" cy="(\d+)"', TRACES)
MARK = re.search(r"<svg[^>]*>(.*)</svg>", (ROOT / "docs/images/mark.svg").read_text(), re.S).group(1)
MARK = re.sub(r"<!--.*?-->", "", MARK)


class Doc:
    """One SVG: collects the glyphs each family uses, then embeds only those."""

    def __init__(self, w, h, theme):
        self.w, self.h, self.T = w, h, THEMES[theme]
        self.used, self.parts, self.defs, self.css = {}, [], [], []

    def text(self, x, y, s, fam, size, fill, anchor="start", tracking=0.0, cls="", extra=""):
        self.used.setdefault(fam, set()).update(s)
        ls = f' letter-spacing="{tracking}em"' if tracking else ""
        c = f' class="{cls}"' if cls else ""
        return self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" fill="{fill}" '
                        f'text-anchor="{anchor}"{ls}{c}{extra}>{html.escape(s)}</text>')

    def label(self, x, y, s, size=13, fill=None, anchor="start", cls=""):
        """A silkscreen label: condensed, tracked, uppercase."""
        return self.text(x, y, s.upper(), "readme-label", size, fill or self.T["faint"], anchor, 0.07, cls)

    def add(self, s):
        self.parts.append(s)
        return s

    def traces(self, x, y, w, h, clip=""):
        """The app's trace field, tiled as the page tiles it."""
        T = self.T
        vias = "".join(f'<circle cx="{cx}" cy="{cy}" r="3.2"/>' for cx, cy in TRACE_VIAS)
        self.defs.append(f'<pattern id="tr" width="720" height="720" patternUnits="userSpaceOnUse">'
                         f'<path d="{TRACE_PATH}" fill="none" stroke="{T["trace"]}" stroke-opacity="{T["traceop"]}" stroke-width="2" stroke-linejoin="round"/>'
                         f'<g fill="{T["via"]}" stroke="{T["trace"]}" stroke-opacity="{T["traceop"]}" stroke-width="1.6">{vias}</g></pattern>')
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="url(#tr)"{clip}/>')

    def footprint(self, x, y, w, h, c=14, fill=None, stroke=None, sw=1):
        """A section: square, one chamfered pin-1 corner, a pin-1 dot (DESIGN.md, Shapes)."""
        T = self.T
        self.add(f'<path d="M{x + c} {y}H{x + w}V{y + h}H{x}V{y + c}Z" fill="{fill or T["mask"]}" stroke="{stroke or T["line"]}" stroke-width="{sw}"/>')
        self.add(f'<circle cx="{x + c * 0.58:.1f}" cy="{y + c * 0.58:.1f}" r="2" fill="{T["ink"]}"/>')

    def designator(self, x, y, s, fill_behind, size=13):
        """A label printed on a footprint's top outline past the chamfer, knocked out of the line, as the app prints
        part designators."""
        w = measure(s.upper(), "readme-label", size, 0.07)
        self.add(f'<rect x="{x - 8}" y="{y - 2}" width="{w + 16:.1f}" height="4" fill="{fill_behind}"/>')
        self.label(x, y + size * 0.36, s, size)
        return w

    def led(self, x, y, r, color, dark, ident):
        """An LED lens: bright core, coloured body, dark rim (DESIGN.md, Colors)."""
        self.defs.append(f'<radialGradient id="{ident}" cx=".4" cy=".35" r=".885"><stop offset=".14" stop-color="#fff"/>'
                         f'<stop offset=".42" stop-color="{color}"/><stop offset="1" stop-color="{dark}"/></radialGradient>')
        return self.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#{ident})" stroke="rgb(0 0 0 / 0.35)" stroke-width="1"/>')

    def fontfaces(self):
        out = []
        for fam, chars in self.used.items():
            f = TTFont(io.BytesIO(instance(fam)[0]))
            o = subset.Options()
            o.flavor, o.hinting, o.name_IDs, o.notdef_outline, o.layout_features = "woff2", False, [], True, ["*"]
            s = subset.Subsetter(o)
            s.populate(text="".join(chars) + " ")
            s.subset(f)
            buf = io.BytesIO()
            f.save(buf)
            out.append(f"@font-face{{font-family:'{fam}';src:url(data:font/woff2;base64,{base64.b64encode(buf.getvalue()).decode()}) format('woff2')}}")
        return "".join(out)

    def svg(self):
        css = "".join(self.css)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
                f"<defs><style>{self.fontfaces()}{css}</style>{''.join(self.defs)}</defs>{''.join(self.parts)}</svg>\n")

    def write(self, name):
        p = OUT / name
        p.write_text(self.svg())
        print(f"{p}  {p.stat().st_size // 1000} KB")


def want(group):
    return not A.only or group in A.only


# ------------------------------------------------------------------ the board
_board = {}


def board(width):
    """The app's render, trimmed, scaled to `width` px (2x of where it is shown) and WebP-encoded: (aspect, data URI)."""
    if width not in _board:
        im = Image.open(A.board).convert("RGBA")
        im = im.crop(im.getbbox())
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=90, method=6)
        _board[width] = (im.width / im.height, "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode())
    return _board[width]


# Parts on the trimmed render, as fractions of its width and height: where a leader's pad lands (a bare corner of the
# part, never its printed marking: DESIGN.md, Callouts). Measured on docs/images/src/board.png.
PARTS = {"fan": (0.215, 0.235), "soc": (0.344, 0.480), "nvme": (0.520, 0.753), "ram": (0.486, 0.355)}


def leader(doc, bx, by, px, py, cls=""):
    """Horizontal run from the callout, then exactly 45 degrees into the part (or the diagonal first, then vertical),
    like a PCB trace (DESIGN.md, The 45 degree Rule). Returns the path length for the draw-in animation."""
    dx, dy = px - bx, py - by
    sx, sy = (1 if dx >= 0 else -1), (1 if dy >= 0 else -1)
    if abs(dx) >= abs(dy):
        jx = px - sx * abs(dy)
        d = f"M{bx:.1f} {by:.1f}H{jx:.1f}L{px:.1f} {py:.1f}"
        length = abs(jx - bx) + abs(dy) * math.sqrt(2)
    else:
        jy = by + sy * abs(dx)
        d = f"M{bx:.1f} {by:.1f}L{px:.1f} {jy:.1f}V{py:.1f}"
        length = abs(dx) * math.sqrt(2) + abs(py - jy)
    T = doc.T
    doc.add(f'<g class="{cls}" style="--l:{length:.0f}"><path d="{d}" fill="none" stroke="{T["field"]}" stroke-width="5" stroke-opacity="0.9" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{T["lead"]}" stroke-width="1.5" stroke-linejoin="round"/></g>')
    doc.add(f'<circle class="{cls}p" cx="{px:.1f}" cy="{py:.1f}" r="3.5" fill="{T["field"]}" stroke="{T["ink"]}" stroke-width="1.5"/>')
    return length


CW, CH = 204, 82  # a callout box; the app's are 168 px, these are read at 65 % in the README


def callout(doc, x, y, name, value, sub, cls, swatch=None):
    """A reading pinned to a part, drawn as the app draws it: label, value, one sub-line, on a near-opaque field."""
    T = doc.T
    doc.add(f'<g class="{cls}">')
    doc.add(f'<rect x="{x}" y="{y}" width="{CW}" height="{CH}" fill="{T["field"]}" fill-opacity="0.9" stroke="{T["line"]}"/>')
    doc.label(x + 12, y + 23, name, 14)
    vx = x + 12
    if swatch:  # a heat swatch before a temperature, as the app draws one
        doc.add(f'<rect x="{vx}" y="{y + 35}" width="16" height="16" fill="{swatch}" stroke="rgb(0 0 0 / 0.4)"/>')
        vx += 24
    doc.text(vx, y + 51, value, "readme-text", 29, T["ink"], extra=' style="font-feature-settings:\'tnum\'"')
    doc.text(x + 12, y + 72, sub, "readme-text", 15, T["dim"], extra=' style="font-feature-settings:\'tnum\'"')
    doc.add("</g>")


# ------------------------------------------------------------------ banner and social preview
def banner(theme, social=False):
    w, h = (1280, 640) if social else (1280, 400)
    d = Doc(w, h, theme)
    T = d.T
    rx = 0 if social else 18
    d.defs.append(f'<clipPath id="r"><rect width="{w}" height="{h}" rx="{rx}"/></clipPath>')
    d.add(f'<g clip-path="url(#r)">')
    d.add(f'<rect width="{w}" height="{h}" fill="{T["field"]}"/>')
    d.traces(0, 0, w, h)
    # a faint darkening at the edges, as the page has (style.css body)
    d.defs.append(f'<radialGradient id="vg" cx=".5" cy="0" r="1.1"><stop offset=".4" stop-color="{T["field"]}" stop-opacity="0"/><stop offset="1" stop-color="{"#030806" if theme == "dark" else "#cfd6cb"}" stop-opacity=".55"/></radialGradient>')
    d.add(f'<rect width="{w}" height="{h}" fill="url(#vg)"/>')

    # the board, 2x of its shown size, right of the name; the social card has no callouts and a bigger board
    aspect, uri = board(1200)
    bw = 540 if social else 384
    bh = bw / aspect
    bx, by = (w - bw - 30, (h - bh) / 2 + 36) if social else (800, 20)
    d.add(f'<image class="bd" href="{uri}" x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{bh:.1f}"/>')
    px = lambda part: (bx + PARTS[part][0] * bw, by + PARTS[part][1] * bh)

    # the name, the tagline, the verdict
    nx, ny = 72, (250 if social else 198)
    ns = 150 if social else 128
    d.text(nx - 4, ny, "pidash", "readme-display", ns, T["ink"], cls="nm", extra=' letter-spacing="-0.01em"')
    d.text(nx, ny + (56 if social else 54), "Mission control for your Raspberry Pi 5", "readme-text", 34 if social else 33, T["dim"], cls="tg")
    vy = ny + (134 if social else 122)
    d.add('<g class="vd">')
    d.led(nx + 8, vy - 7, 7, T["ok"], T["okdk"], "ledok")
    d.text(nx + 24, vy, "Healthy", "readme-medium", 22, T["ink"])
    d.text(nx + 24 + measure("Healthy", "readme-medium", 22) + 12, vy, "no throttling since boot, no failed services", "readme-text", 17, T["dim"])
    d.add("</g>")

    if not social:
        # callouts frame the board: the fan top-left, the SoC mid-left, the NVMe bottom-right, each joined to its part
        fx, fy = 566, 22
        sx, sy = 596, 134
        qx, qy = w - CW - 18, h - CH - 18
        leader(d, fx + CW, fy + CH / 2, *px("fan"), cls="l1")
        leader(d, sx + CW, sy + CH / 2, *px("soc"), cls="l2")
        leader(d, qx, qy + CH / 2, *px("nvme"), cls="l3")
        callout(d, fx, fy, "Blower fan", "4,071 rpm", "38 % · Performance", "c1")
        callout(d, sx, sy, "SoC · BCM2712", "44.1 °C", "9 % load · 1.50 GHz", "c2", swatch="#c17a42")
        callout(d, qx, qy, "NVMe · SN580", "35.9 °C", "R 0 B/s · W 0 B/s", "c3", swatch="#7d5a3e")
    d.add("</g>")

    if social:
        return d
    # the entrance, as the app draws it: name and tagline rise, each box opens top-down just before its leader draws,
    # the LED lights last. Static renderers show the finished state.
    ease = "cubic-bezier(0.2,0.75,0.1,1)"
    d.css.append(
        "@keyframes rise{from{opacity:0;transform:translateY(22px)}}@keyframes open{from{clip-path:inset(0 0 100% 0)}}"
        "@keyframes draw{from{stroke-dashoffset:var(--l)}}@keyframes fade{from{opacity:0}}"
        f".nm{{animation:rise .7s {ease} both}}.tg{{animation:rise .7s .12s {ease} both}}.vd{{animation:fade .5s 2.1s both}}"
        + "".join(f".c{i}{{animation:open .4s {0.75 + 0.3 * (i - 1):.2f}s {ease} both}}"
                  f".l{i} path{{stroke-dasharray:var(--l);animation:draw .45s {1.0 + 0.3 * (i - 1):.2f}s linear both}}"
                  f".l{i}p{{animation:fade .2s {1.4 + 0.3 * (i - 1):.2f}s both}}" for i in (1, 2, 3))
        + "@media(prefers-reduced-motion:reduce){*{animation:none!important}}")
    return d


# ------------------------------------------------------------------ CTA pads (DESIGN.md, Buttons: flat gold, or ghost)
def cta(theme, label, kind):
    tw = measure(label, "readme-semibold", 19)
    w, h = round(tw + 60), 48
    d = Doc(w, h, theme)
    T = d.T
    if kind == "primary":
        d.add(f'<rect width="{w}" height="{h}" rx="2" fill="{T["gold"]}"/>')
        d.text(w / 2, 31, label, "readme-semibold", 19, T["goldink"], anchor="middle")
    else:
        d.add(f'<rect x="1" y="1" width="{w - 2}" height="{h - 2}" rx="2" fill="none" stroke="{T["gold"]}" stroke-opacity="0.55" stroke-width="1.5"/>')
        d.text(w / 2, 31, label, "readme-semibold", 19, T["goldhi"], anchor="middle")
    return d


# ------------------------------------------------------------------ spec cards: 400x250 with a transparent half-gutter
SPECS = [  # (label, value lines, sub, mono); each verified in the manifest, the installer or a run (README.md)
    ("Install", ["sudo ./install.sh"], "on the Pi, after one npm build", True),
    ("Requires", ["Python 3.11+", "Node 20.19+ to build"], "FastAPI, uvicorn, websockets, psutil", False),
    ("Runs on", ["Raspberry Pi 5", "Pi OS trixie, 64-bit"], "with Tailscale on the Pi", False),
    ("Reads", ["SoC, PMIC, RP1, NVMe", "fan tach, systemd, Docker"], "every number with its unit", False),
    ("Serves", ["one page, port 8787", "on your tailnet only"], "never the LAN or the internet", False),
    ("Live data", ["1 Hz, one socket", "10 min of history"], "the fan loop runs on the Pi itself", False),
    ("Fan profiles", ["Silent · Balanced", "Performance · Max"], "and a Custom curve you draw", False),
    ("License", ["MIT"], "no telemetry, no accounts", False),
]


def spec(theme, n, label, lines, sub, mono):
    d = Doc(432, 270, theme)
    T = d.T
    d.add('<g transform="translate(16 10)">')
    d.footprint(0, 0, 400, 250)
    d.designator(36, 0, label, T["mask"], 17)
    fam, size = ("readme-mono", 31) if mono else ("readme-medium", 35)
    size = min([size] + [size * 328 / measure(l, fam, size) for l in lines])  # two lines of 328 px at most
    y0 = 130 if len(lines) == 1 else 112
    for i, line in enumerate(lines):
        d.text(36, y0 + i * 44, line, fam, size, T["ink"], extra=' style="font-feature-settings:\'tnum\'"')
    d.text(36, 212, sub, "readme-text", 19, T["dim"])
    d.add("</g>")
    return d


# ------------------------------------------------------------------ rule: a silkscreen trace with a hollow pad
def rule(theme):
    d = Doc(1600, 28, theme)
    T = d.T
    d.add(f'<path d="M0 19H728L738 9H782" fill="none" stroke="{T["line2"]}" stroke-width="1.5" stroke-linejoin="round"/>')
    d.add(f'<path d="M818 9H862L872 19H1600" fill="none" stroke="{T["line2"]}" stroke-width="1.5" stroke-linejoin="round"/>')
    d.add(f'<circle cx="800" cy="9" r="6" fill="none" stroke="{T["ink"]}" stroke-opacity="0.7" stroke-width="1.5"/>')
    return d


# ------------------------------------------------------------------ outro: the install line, as the page would print it
def outro(theme):
    d = Doc(1600, 260, theme)
    T = d.T
    d.footprint(1, 12, 1598, 247, c=24)
    d.designator(48, 12, "pidash · on the Pi", T["mask"], 16)
    d.add(f'<g transform="translate(96 84) scale(3.25)" style="color:{T["gold"]}">{MARK.replace("#d9b35d", "currentColor").replace("#0b1712", T["mask"])}</g>')
    d.text(260, 136, "sudo ./install.sh", "readme-mono", 56, T["ink"])
    d.text(262, 184, "One command on the Pi. It prints your token once; run it again to update.", "readme-text", 23, T["dim"])
    d.label(262, 222, "Keeps your settings, token and fan profile · uninstall.sh undoes it all", 15)
    return d


# ------------------------------------------------------------------ contribute card: one author so far, no faked wall
def contribute(theme):
    d = Doc(1600, 300, theme)
    T = d.T
    d.footprint(1, 12, 1598, 287, c=24)
    d.designator(48, 12, "contributing", T["mask"], 16)
    d.add(f'<g transform="translate(96 104) scale(3.25)" style="color:{T["gold"]}">{MARK.replace("#d9b35d", "currentColor").replace("#0b1712", T["mask"])}</g>')
    d.text(260, 128, "Contributions are open", "readme-display", 44, T["ink"], extra=' letter-spacing="-0.01em"')
    d.text(262, 176, "One author so far. Issues and pull requests are welcome, and you don't need a Pi: the page's demo mode", "readme-text", 23, T["dim"])
    d.text(262, 208, "and pidash --mock serve made-up data, and the browser checks cover the nav, sign-in and every action.", "readme-text", 23, T["dim"])
    d.label(262, 254, "Backend · Python 3.11 · unittest        Frontend · Vite · no framework · three.js        CI on every push", 15)
    return d


# ------------------------------------------------------------------ build
for theme in ("dark", "light"):
    if want("banner"):
        banner(theme).write(f"banner-{theme}.svg")
    if want("social") and theme == "dark":
        # the social preview: the dark card at 1280x640, screenshotted by Chromium once its entrance has played
        # (GitHub takes a PNG under 1 MB, in Settings > Social preview; the README doesn't use it)
        import subprocess, tempfile
        chrome = next((c for c in (os.environ.get("CHROME", ""), "chromium", "google-chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome") if c and shutil.which(c)), None)
        if not chrome:
            print("social-preview.png skipped: no Chromium (set CHROME)")
        else:
            with tempfile.TemporaryDirectory() as td:
                pathlib.Path(td, "social.svg").write_text(banner(theme, social=True).svg())
                pathlib.Path(td, "social.html").write_text('<!doctype html><body style="margin:0"><img src="social.svg" width="1280" height="640">')
                # headless Chromium's window is taller than its viewport by its own chrome, so shoot tall and crop
                shot = pathlib.Path(td, "shot.png")
                subprocess.run([chrome, "--headless", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--force-device-scale-factor=1",
                                "--window-size=1280,900", f"--screenshot={shot}", pathlib.Path(td, "social.html").as_uri()], check=True, capture_output=True)
                Image.open(shot).crop((0, 0, 1280, 640)).save(OUT / "social-preview.png", optimize=True)
                print(f"{OUT / 'social-preview.png'}  {(OUT / 'social-preview.png').stat().st_size // 1000} KB")
    if want("cta"):
        cta(theme, "Get started", "primary").write(f"cta-start-{theme}.svg")
        cta(theme, "Watch the demo", "ghost").write(f"cta-demo-{theme}.svg")
    if want("spec"):
        for i, (label, lines, sub, mono) in enumerate(SPECS, 1):
            spec(theme, i, label, lines, sub, mono).write(f"spec-{i}-{theme}.svg")
    if want("rule"):
        rule(theme).write(f"rule-{theme}.svg")
    if want("outro"):
        outro(theme).write(f"outro-{theme}.svg")
    if want("contribute"):
        contribute(theme).write(f"contribute-{theme}.svg")
