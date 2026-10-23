// The heat ramp and the fixed 30-90 °C scale (DESIGN.md), and clamp. No browser globals: loads under plain node.
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ------------------------------------------------------------------ palette

/**
 * Heated metal: cool board → dim copper → copper → orange → yellow → white-hot, luminance rising all the way.
 * Temperatures are the only thing drawn with it; health states use the LED colours in styles/tokens.css.
 */
// stops sit early, so the everyday 40-65 °C band crosses brown, copper and orange: a warm part reads warm
export const RAMP = [
  [0.0, [51, 66, 60]],
  [0.2, [125, 90, 62]],
  [0.38, [193, 122, 66]],
  [0.56, [238, 141, 52]],
  [0.76, [255, 192, 77]],
  [1.0, [255, 244, 220]],
]

export function rampRGB(t) {
  t = clamp(t, 0, 1)
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i]
    if (t <= t1) {
      const [t0, c0] = RAMP[i - 1]
      const k = (t - t0) / (t1 - t0)
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k))
    }
  }
  return RAMP[RAMP.length - 1][1]
}
export const rampCSS = (t, a = 1) => {
  const [r, g, b] = rampRGB(t)
  return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`
}
const LUT = Array.from({ length: 256 }, (_, i) => rampCSS(i / 255))
export const rampAt = (t) => LUT[Math.round(clamp(t, 0, 1) * 255)]
export const rampGradient = (dir = 'to right') =>
  `linear-gradient(${dir}, ${RAMP.map(([t, c]) => `rgb(${c.join(' ')}) ${t * 100}%`).join(', ')})`

/** Dark or light ink for text sitting on the ramp colour at t (WCAG luminance crossover). */
export function inkOn(t) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = rampRGB(t)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.18 ? '#15100a' : '#ffffff'
}

/** One fixed temperature scale for every thermal colour on the page (the scale bar in the thermal view shows it). */
export const T_MIN = 30
export const T_MAX = 90
export const heat = (c) => (c == null ? 0 : clamp((c - T_MIN) / (T_MAX - T_MIN), 0, 1))
