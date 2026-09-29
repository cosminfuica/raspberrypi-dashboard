---
name: pidash
description: A live Raspberry Pi 5 dashboard drawn in the board's own manufacturing language.
colors:
  field: "#07110d"
  solder-mask: "#0b1712"
  solder-mask-raised: "#10201a"
  solder-mask-track: "#163026"
  solder-mask-edge: "#1d3d31"
  silkscreen: "#edf0e8"
  silkscreen-dim: "#b3bfb6"
  silkscreen-faint: "#8a9a90"
  enig-gold: "#d9b35d"
  enig-gold-bright: "#f0cf7e"
  enig-gold-low: "#b18a3e"
  gold-ink: "#1c1505"
  led-green: "#45d983"
  led-amber: "#ffb93e"
  led-red: "#ff5f55"
  led-blue: "#8fb8c8"
  led-off: "#52635a"
  probe-white: "#e8ece4"
  probe-cyan: "#6fc3d1"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 94"
  verdict:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 100"
  headline:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 116"
  title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.25
    fontVariation: "'wdth' 112"
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 78"
rounded:
  none: "0px"
  pad: "2px"
  chamfer: "14px"
  chamfer-stage: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  section: "52px"
components:
  pad-gold:
    backgroundColor: "{colors.enig-gold}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.pad}"
    padding: "0 16px"
    height: "36px"
  pad-gold-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.enig-gold-bright}"
    rounded: "{rounded.pad}"
    padding: "0 12px"
    height: "32px"
  pad-icon:
    backgroundColor: "{colors.enig-gold}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.pad}"
    size: "32px"
  preset-pad:
    backgroundColor: "transparent"
    textColor: "{colors.silkscreen}"
    rounded: "{rounded.pad}"
    padding: "5px 12px"
    height: "46px"
  preset-pad-selected:
    backgroundColor: "{colors.enig-gold}"
    textColor: "{colors.gold-ink}"
  footprint:
    backgroundColor: "{colors.solder-mask}"
    textColor: "{colors.silkscreen}"
    rounded: "{rounded.chamfer}"
    padding: "20px"
  callout:
    backgroundColor: "{colors.field}"
    textColor: "{colors.silkscreen}"
    rounded: "{rounded.none}"
    padding: "8px 10px 9px"
    width: "168px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.silkscreen-dim}"
    padding: "10px 12px 9px"
  tab-current:
    textColor: "{colors.silkscreen}"
  search-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.silkscreen}"
    rounded: "{rounded.pad}"
    height: "36px"
    padding: "0 36px 0 12px"
---

# Design System: pidash

## Overview

**Creative North Star: "The Silkscreen"**

The dashboard is drawn in the same language as the board it watches. The page is a solder-mask field with copper traces running under it, and every label is printed silkscreen. Each section is a component footprint, and the controls you touch are ENIG gold pads. Nothing is borrowed from generic admin UI: no cards floating on grey, no gradients standing in for depth, no accent colour chosen for mood. Every visual device already exists on a Raspberry Pi 5, which is why the page reads as one object.

Colour is information, never decoration. Heated-metal colours mean temperature and nothing else. LED colours mean health and nothing else. Gold means "you can press this" and nothing else. The field stays a cool green-black, so any of those three signals is visible from across the room. The density is that of an instrument: tabular figures, tight silkscreen caps, generous space between footprints and very little inside them.

Depth belongs to the 3D centrepiece, an exploded Pi 5 and NEO 5 stack whose parts glow at their real temperatures and whose blower spins at the tach speed. The 2D page around it stays flat, as a board is flat.

**Key Characteristics:**
- Solder-mask ground with a copper trace field underneath (`traces.svg`), never a flat or gradient background.
- Silkscreen caps labels (condensed, tracked) against wide, heavy headings: the type contrast lives on the width axis.
- One control material, flat ENIG gold; one data material per meaning (heat ramp, LEDs, probe channels).
- Footprint sections with a chamfered pin-1 corner, a pin-1 dot, and real part designators printed on the outline.
- 45°/90° routing for every drawn connection, like PCB traces.

## Colors

A cool green-black board with bright silkscreen, one gold for controls, and colours that carry meaning.

### Primary
- **ENIG Gold** (#d9b35d): every control and nothing else. Buttons, the selected fan preset, curve handles, the current tab underline, the focus ring (in its bright variant). Flat, never with a sheen, because real ENIG plating is a flat satin.
- **ENIG Gold Bright** (#f0cf7e): hover and focus on gold, and the ghost button's text.
- **Gold Ink** (#1c1505): text on gold.

### Secondary
- **LED Green / Amber / Red** (#45d983 / #ffb93e / #ff5f55): health states only (ok, check, problem). They are drawn as small lens LEDs with a bright core, never as fills or glows. **LED Blue** (#8fb8c8) marks information and **LED Off** (#52635a) marks inactive.

### Tertiary
- **Heated Metal ramp** (defined in `util.js` RAMP and mirrored as `--ramp`): cool board → dim copper → copper → orange → yellow → white-hot. It spans 30–90 °C, with stops at 0 / 20 / 38 / 56 / 76 / 100 %, and luminance rises the whole way. It is used only for temperatures: part glows, swatches, thermal strips, the temperature series. The legend under the board shows the scale.
- **Probe White / Probe Cyan** (#e8ece4 / #6fc3d1): non-temperature data series (load, throughput tx/rx, memory), like the two channels of a scope.

### Neutral
- **Field** (#07110d): the page ground under the trace field.
- **Solder Mask** (#0b1712): footprint (section) surfaces. **Raised** (#10201a) is for notices, **Track** (#163026) for meter tracks and fills, **Edge** (#1d3d31) for scrollbars.
- **Silkscreen** (#edf0e8): primary text. **Dim** (#b3bfb6) is secondary text, **Faint** (#8a9a90) is labels and captions. All three pass 4.5:1 on the mask.
- **Silkscreen lines**: rgb(237 240 232) at 0.16 for outlines, 0.30 for lit outlines, 0.40 for form-field boundaries (at least 3:1 on the field, the mask and the raised mask), 0.07 for hairlines.

### Named Rules
**The One Meaning Rule.** Each colour family means exactly one thing: heat ramp for temperature, LEDs for health, gold for controls. A gold status badge or an amber button is a bug.

**The Cool Field Rule.** The ground stays green-black (#07110d–#0b1712). It never drifts to slate or neutral grey, because the warm signals only read against the cool board.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui fallback)
**Body Font:** Archivo Variable
**Label Font:** Archivo Variable at condensed width

**Character:** A single variable grotesk carries the whole system. Headings run wide and heavy, like component values printed across a part. Labels run condensed and tracked, like silkscreen reference text. The width axis does the work a second typeface would do. All figures are tabular.

### Hierarchy
- **Display** (300, 3rem, line-height 1, width 94 %, −0.03em): the big live readings (fan rpm, CPU %). Light weight, so a changing number never shouts.
- **Verdict** (700, 1.75rem, line-height 1.1, width 100 %, −0.01em, balanced wrap; 1101 px and wider): the health verdict, the page's headline, louder than any section heading or live reading. Narrower, it keeps the Headline size.
- **Headline** (700, 1.25rem, width 116 %, −0.01em): footprint (section) headings.
- **Title** (700, 1rem, width 112 %): sub-heads inside a footprint (Top processes, Throughput).
- **Body** (400, 0.875rem, line-height 1.45, tabular figures): values, table cells, prose. Prose lines stay short; this is an instrument, not an article.
- **Label** (600, 0.75rem, width 78 %, 0.07em tracking, uppercase, Silkscreen Faint): every caption, table header, key, callout name and part designator. Figures inside a label keep their case (GiB, not GIB).

### Named Rules
**The Width Axis Rule.** Hierarchy comes from width and weight on one face (wide/heavy headings, condensed/tracked labels). A second display face is never added.

**The Tabular Rule.** Every number on the page uses tabular figures, units are joined with a no-break space, and negatives use a true minus (−).

## Layout

A sticky header (60 px) and a sticky, keyed section strip (keys 1–0, then - and =) sit above a centred main column, max 1640 px wide with 24 px side padding. The hero pairs the sticky 3D stage (fluid width) with a 380 px right column: the health verdict, then the fan readout and profile pads. Below the hero, the fan curve editor spans the full width. After it comes a two-column masonry: 4 px auto rows, with each section's row span measured in JS. The left column holds the software running on the Pi (processor, services, containers), and the right column holds the hardware and its links (thermals, power, memory, storage, network, tailnet). The columns are balanced to end together. Last come the controls for the Pi itself, a fixed pair on the same 7/5 split that ends together: the console under the software, System (update, reboot) under the hardware.

Rhythm: 20 px gaps and padding inside footprints, 52 px between footprints, 8/12 px inside groups.

Responsive:
- **Under 1100 px:** one column. The verdict comes first (701–1100 px: a band with its reasons beside the headline), then the stage (701–1100 px: short enough to end at the fold with the band), then the fan card (701–1100 px: readout | profiles), then the sections in document (nav) order. The stage stops being sticky.
- **Under 700 px:**
  - The callouts become a two-column grid under the 3D view.
  - Padding drops to 16 px.
  - The section strip and profile tabs scroll sideways, with a fade-out edge as the scroll cue.
- **420 px and under:** the header's Sign in pad is its padlock alone, so an 11-character hostname fits (see Privileged actions).

### Named Rules
**The Health First Rule.** On every viewport, the verdict and its reasons are visible without scrolling.

## Elevation & Depth

The 2D page is flat, with tonal layering only: field, then mask, then raised mask. Footprints are separated by outline and spacing, never by shadow. There are two exceptions. The 3D stage owns real depth: PBR materials, a key light with shadows, and additive heat halos on the board surface. The dialogs (sign in, confirm), the only surfaces that float over the page, get a single soft drop shadow. Toasts stay flat: a raised-mask notice with a lit outline, pinned to the corner.

### Shadow Vocabulary
- **Dialog** (`box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.8)`): the sign-in and confirm dialogs only.
- **Lens edge** (`box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.35)`): the rim of an LED lens.

### Named Rules
**The Flat Board Rule.** Nothing on the 2D page floats. If a surface needs to stand out, it gets a lit outline (0.30 silkscreen) or a gold edge, not a shadow.

## Shapes

The shapes are rectangles, with the pin-1 chamfer as the only cut. A footprint's top-left corner is chamfered at 14 px (24 px on the stage) using `corner-shape: bevel`. In engines without it, the corner stays square, never rounded. A 4 px pin-1 dot sits inside the chamfer. Controls use a 2 px corner, and LEDs and pads are circles. Every drawn connection runs horizontal, vertical or at exactly 45°: callout leaders, the trace field, the assembly lines in the 2D drawing.

### Named Rules
**The 45° Rule.** Lines route like PCB traces, at 0°, 45° or 90° only. A leader bends beside its callout, in the empty field, and runs straight into its part.

**The No Round Card Rule.** Sections are never rounded rectangles. A footprint is square with one chamfered corner.

## Components

### Buttons (gold pads)
- **Shape:** 2 px corners, 36 px tall (32 px small, 44 px icon pads on touch). On touch, a small control that keeps its size (the header's Sign in pad, the Low power switch) gets a transparent 44 px hit area around it, so nothing moves.
- **Primary:** flat ENIG Gold with Gold Ink text, 650 weight. Hover brightens by 8 %; the pressed state darkens.
- **Ghost:** transparent, with a 55 % gold outline and Gold Bright text. It is used when the action is secondary (Sign out). Hover adds a 10 % gold wash.
- **Busy:** a thin moving sheen along the bottom edge, with a progress cursor.
- **Active states are not buttons.** When a profile is already in use, the button is replaced by a status line (LED plus "Balanced is driving the fan"), never a disabled gold pad.

### Profile pads (fan presets)
- A stack of 46 px rows: name, a one-line hint, and a 64 px mini curve drawn in silkscreen.
- The selected preset is a flat ENIG Gold fill with Gold Ink text. Hover adds a gold wash.

### Footprints (sections)
- **Corner Style:** the chamfered top-left corner (14 px) plus a pin-1 dot.
- **Background:** Solder Mask on the Field.
- **Border:** a 1 px silkscreen outline at 0.16. It lights to 0.30 when the matching board part is hovered, in either direction (board ↔ section).
- **Designator:** a real part marking (BCM2712, DA9091, LPDDR4X, SN580) printed on the top outline past the chamfer, knocked out of the line. Only sections that map to a real part get one.
- **Internal Padding:** 20 px (16 px on mobile).

### Callouts (board stage)
- 168 px silkscreen boxes on a near-opaque field (0.88), placed in fixed left and right columns. No backdrop blur: blurring a canvas that redraws every frame costs a third of the page's GPU time.
- Hidden until the view has placed them, so they never sit in a pile while the board loads. The entrance (not under reduced motion) opens each box top-down just before its leader draws: a clip, never a fade, so text is never shown at partial contrast.
- Each holds a label name, a live value (with a heat swatch when it is a temperature), and a sub-line.
- Each is joined to its part by a 45°/90° leader with a dark halo, ending in a hollow pad on the part's bare corner, never on its printed marking.
- Boxes never overlap. The stack is re-spaced every frame while the board sways.

### Inputs / Fields
- **Style:** Field-coloured background, a silkscreen outline at 0.40, 2 px corners, 36 px tall.
- **Focus:** a 2 px Gold Bright outline, offset 2 px (the global focus ring).
- **Error:** a notice below the field (LED Red text, raised mask), naming the problem and the fix.

### Navigation (the keyed strip)
- Silkscreen tabs, each with a keycap (1–0, then - and =: the keyboard's number row) that works as a keyboard shortcut. The current section gets Silkscreen text and a 2 px gold underline. The strip follows the scroll position.
- On mobile it scrolls sideways, with a fading right edge.

### Privileged actions (sign in, confirm, toasts)
- **Locked / unlocked:** signed out, the header's Sign in pad carries a closed padlock, and so does every control that needs the token. Signed in, an open padlock and "Unlocked" sit beside a ghost Sign out. At 420 px and under the pad is its padlock alone: closed and gold to sign in, open and ghost to sign out; the words stay for assistive tech.
- **Confirm:** every destructive action asks first in a dialog: a title that is the question ("Restart ssh?"), what happens, an optional warning notice (what else goes down with it), then Cancel (ghost, focused, so Enter or Escape never confirms) and the action (gold).
- **Toasts:** the outcome of an action, bottom right: an LED (health colours), one sentence, a dismiss button. Errors stay until dismissed and are `role="alert"`; the rest leave after 6 s, not while hovered.
- **Busy:** the pressed control keeps its place and focus (`aria-disabled`) and shows the busy sheen; a restart icon spins in LED amber.

### Console, update log and service logs
- The only monospace on the page: text laid out in columns by the program that wrote it (`--mono`, the platform's UI monospace). The terminal sits on the field in a silkscreen outline, with xterm.js themed from the palette: silkscreen text, a gold cursor and selection, LED colours for ANSI.
- A service's journal (the logs dialog, opened from its Services row) uses the same log well: the time in faint silkscreen, the process in the chart cyan, and the line in LED colours by syslog priority (error red, warning amber, notice in full silkscreen, info as the log's dim text, debug faded).
- Disconnected, a field-coloured cover says why (the close code, in words) and offers Connect or Reconnect. A new connection is a new shell, so it never reconnects by itself.
- On touch screens a row of ghost pads adds the keys a phone keyboard lacks: Esc, Tab, a latching Ctrl, arrows.

### Signature: the exploded board
- A Three.js model of the Pi 5 in the Argon NEO 5: the blower layer, the board, and the M.2 base with the SN580 on a live PCIe ribbon.
- Part halos and chip emissives follow the heat ramp. Metal lids are tinted rather than lit, so they never wash out. Port shells and cans are brushed steel (roughness 0.5), dimmer than the SoC lid, so heat and the SoC lead the eye.
- The scene is built in slices, the page getting the main thread back between them, and its shaders compile before the first frame. Until it is placed the stage says "Loading the board…".
- The blower spins at the tach speed. Traffic pulses run along the Wi-Fi and PCIe nets.
- Low power, or no WebGL, swaps it for a flat 2D assembly drawing with the same callouts, set between the callout columns like the model. It has three line weights (board edge 0.5, courtyards 0.22, detail 0.12), port lips, pin-1 dots, the PCIe ribbon and the fan cable routed at 45°/90°, the M.2 key and screw, and port names as the drawing's annotations outside the board edge (left out where they would print under 7 px). prefers-reduced-motion stops the idle sway and the entrance.

### Health verdict
- An LED and a headline (the Verdict role) over its reasons: up to six rows, each an LED badge and one sentence that links to its section. Healthy shows what was checked: the SoC reading, no under-voltage or throttling since boot, no failed services.
- The list keeps room for three one-line reasons from the first paint, with a placeholder row ("Reading the Pi's sensors…") until data, so nothing below it moves when it fills in or a reason comes and goes.
- The browser tab carries it too. The title is the headline and the host ("1 problem, 2 to check · cosmin-pi"; healthy, "cosmin-pi · pidash"), and the favicon gains an amber or red LED lens at its lower right.

### Fan curve editor
- A temperature × speed plot with gold handles. The heating line is solid and the cooling line dashed, with the hysteresis band between them.
- The failsafe keep-out is hatched from 80 °C. The stall guard sits at the measured minimum running speed. A heat-coloured "now" marker shows the live reading.
- A linked points table makes every point keyboard-editable. Plot insets keep each handle's hit area clear of the axis labels.

### Forced colors (Windows High Contrast)
- Health and heat keep their own colours (LEDs, badges, heat swatches and strips, the scale bar): they carry meaning the text doesn't repeat.
- Meters get a text-colour outline and a Highlight fill. The segmented stacks keep their colours, which match their legend keys.
- Selections use the system's selection colours: a Highlight underline for the current nav key and curve tab, a Highlight fill for the selected profile, segment and latched key, a Highlight border for the selected interface. The focus ring stays its own mark.
- Charts draw every line in the text colour without area fills, the second series dashed, and their keys match.

## Do's and Don'ts

### Do:
- **Do** draw every temperature with the heated-metal ramp over the fixed 30–90 °C scale, so the same colour means the same temperature everywhere.
- **Do** keep controls flat ENIG Gold (#d9b35d) with Gold Ink text, and use gold for nothing that cannot be pressed.
- **Do** print silkscreen labels at 0.75rem, 78 % width, 0.07em tracking, uppercase.
- **Do** route drawn connections at 0°/45°/90° only.
- **Do** use tabular figures, no-break unit spaces and true minus signs in every reading.
- **Do** theme the parts the browser draws: gold selection, gold caret, a mask-coloured thin scrollbar, the 2 px Gold Bright focus ring.

### Don't:
- **Don't** put a sheen or gradient on gold. ENIG is flat.
- **Don't** use a gold or amber badge for status. Status is an LED plus silkscreen text.
- **Don't** put a caption or kicker above a section heading. A part designator is printed on the outline, and only for a real part.
- **Don't** round section corners or lift sections with shadows.
- **Don't** let a leader or pad sit on a part's printed marking.
- **Don't** add a second typeface. Width and weight on Archivo carry the hierarchy. (The console, the apt log and the service logs use the platform monospace: that is program output laid out in columns, not a type voice.)
