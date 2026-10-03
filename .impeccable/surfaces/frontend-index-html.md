---
version: 1
slug: "frontend-index-html"
primary_target: "frontend/index.html"
related_targets: ["frontend/src"]
---

# Surface: the pidash dashboard (frontend/index.html)

Scope: the whole single-page dashboard. Mode: Operate (a health glance, then detail; fan changes are the one task).
Audience: the owner, who built this Pi 5 into an Argon NEO 5 and knows its parts. Desktop over Tailscale first, phone second.
Content: every section of docs/API.md, live at 1 Hz, plus the fan profile switch and the custom curve editor.
Constraints: static Vite build served by the backend; Three.js centrepiece lazy-loaded; a 2D board switch (and the 2D drawing without WebGL); prefers-reduced-motion; WCAG AA; keyboard-complete curve editor; visible WebSocket state.
Decisions made without the owner (headless run): the direction below was chosen from the brief alone; the owner can re-roll it.

## Direction contract

THESIS: The dashboard is the board. Every reading sits on the part that produces it, and the page is drawn in the Pi's own manufacturing language: solder mask, copper, silkscreen, gold pads. It refuses the category default of a grid of same-size glass cards with a neon accent.

OWN-WORLD: Matte green-black solder mask as the ground, copper traces showing through it, off-white silkscreen for all text, ENIG gold for every control (controls are pads), temperatures drawn only on a heated-metal ramp (cool board, copper, orange, yellow, white-hot), health only in LED colours (green ACT, amber, red PWR). Sections are footprints: 1 px silkscreen outlines with chamfered corners, a reference designator and a pin-1 dot. One family, Archivo, condensed caps for silkscreen labels and tabular figures for data.

STORY: The owner sees at once whether the Pi is healthy and why not, reads any figure where it lives, and changes the fan curve knowing exactly what the fan will do.

FIRST VIEWPORT: Left two thirds: the Pi 5 and its NEO 5 parts in a slow exploded 3D view (blower fan above, board, M.2 base with the SN580 below). The SoC, RP1, PMIC and SSD glow with their real temperatures and the blower spins at the tach's speed. Silkscreen callouts, routed at 45° like traces, carry the live readings of each part. Right third: the health verdict with its reasons as links, then the fan profile pads. Header strip: hostname, model, uptime, the connection LED, the 2D board switch and sign-in.

FORM: PCB layout as interface, candidate 3 of 7 grounded directions (1 exploded 3D board, 2 thermal-camera viewfinder, 3 PCB silkscreen and copper, 4 bench oscilloscope, 5 rack front panel, 6 glass-cockpit EICAS, 7 airflow tunnel). Seed key a5224ab1. The brief-pinned 3D board is carried inside it as the hero.

Raises:
- From the midnight transit diagram: every leader line and connector routes at 45° and 90° only, and the net in focus burns brightest (hovering a section lights its part on the board, and the reverse).
- From the iridescent cloud edge: colour is confined to data and state; text stays achromatic silkscreen.
- From the boarding pass and gate board: reranked rows move in place, and a state change holds its highlight until seen.
- From the teletext service: keyed addresses; number keys jump between sections.
- From the cloud quarry: one active edge; only the element in focus carries the gold edge.
- From Ikeda's datamatics: data-density courage; lists run in tabular figures without padding them into cards.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
