// Fan-curve semantics shared by the curve editor's preview and the demo simulator.
// Source of truth: docs/API.md, "Curve semantics" and the PUT /api/fan/profiles/custom validation rules.

export const DEFAULT_CONSTRAINTS = {
  points_min: 2,
  points_max: 8,
  temp_min_c: 20,
  temp_max_c: 80,
  hysteresis_max_c: 10,
  min_running_pct: 8, // measured on the Pi's fan; the live value arrives in fan_profiles.constraints
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** s(x): linear interpolation between points, flat beyond both ends. */
export function speedAt(points, t) {
  const n = points.length
  if (!n) return 0
  if (t <= points[0].temp_c) return points[0].speed_pct
  for (let i = 1; i < n; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t <= b.temp_c) return a.speed_pct + ((b.speed_pct - a.speed_pct) * (t - a.temp_c)) / (b.temp_c - a.temp_c)
  }
  return points[n - 1].speed_pct
}

/** Stall guard: a speed between 0 and the minimum running speed is raised to that minimum. */
export const guard = (s, min) => (s > 0 && s < min ? min : s)

/**
 * One tick of the 1 Hz control loop. `prev` is the previous tick's result (null on the first tick).
 * Returns {mode, raw, target}: raw is the post-hysteresis speed, target adds the stall guard.
 */
export function step(prev, profile, t, c = DEFAULT_CONSTRAINTS, limits = {}) {
  const on = limits.fan_failsafe_c ?? 80
  const off = limits.fan_failsafe_release_c ?? 75
  if (t == null || t >= on || (prev?.mode === 'failsafe' && t >= off)) return { mode: 'failsafe', raw: 100, target: 100 }
  const s = speedAt(profile.points, t)
  const before = prev ? prev.raw : 0
  const raw = s >= before ? s : Math.min(before, speedAt(profile.points, t + profile.hysteresis_c))
  return { mode: 'curve', raw, target: guard(raw, c.min_running_pct) }
}

/** Mirrors the server's 422 invalid_curve rules. Returns null when valid, else the server-style message. */
export function validateCurve(curve, c = DEFAULT_CONSTRAINTS) {
  const { points, hysteresis_c: h } = curve
  if (!Number.isInteger(h) || h < 0 || h > c.hysteresis_max_c) return `hysteresis_c must be an integer from 0 to ${c.hysteresis_max_c}`
  if (!Array.isArray(points) || points.length < c.points_min || points.length > c.points_max)
    return `a curve needs ${c.points_min} to ${c.points_max} points`
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!Number.isInteger(p.temp_c) || p.temp_c < c.temp_min_c || p.temp_c > c.temp_max_c)
      return `points[${i}].temp_c must be an integer from ${c.temp_min_c} to ${c.temp_max_c}`
    if (!Number.isInteger(p.speed_pct) || p.speed_pct < 0 || p.speed_pct > 100)
      return `points[${i}].speed_pct must be an integer from 0 to 100`
    if (i === 0) continue
    const q = points[i - 1]
    if (p.temp_c <= q.temp_c)
      return `points[${i}].temp_c must be greater than points[${i - 1}].temp_c (${p.temp_c} <= ${q.temp_c})`
    if (p.speed_pct < q.speed_pct)
      return `points[${i}].speed_pct must not be lower than points[${i - 1}].speed_pct (${p.speed_pct} < ${q.speed_pct})`
  }
  return null
}

/** Where point i may go: strictly between its neighbours' temperatures, between their speeds. */
export function pointBounds(points, i, c = DEFAULT_CONSTRAINTS) {
  const lo = points[i - 1]
  const hi = points[i + 1]
  return {
    tMin: lo ? lo.temp_c + 1 : c.temp_min_c,
    tMax: hi ? hi.temp_c - 1 : c.temp_max_c,
    sMin: lo ? lo.speed_pct : 0,
    sMax: hi ? hi.speed_pct : 100,
  }
}

/** Moves point i to (temp, speed), rounded and clamped so the curve stays valid. Returns a new array. */
export function movePoint(points, i, temp, speed, c = DEFAULT_CONSTRAINTS) {
  const b = pointBounds(points, i, c)
  const next = points.slice()
  next[i] = { temp_c: clamp(Math.round(temp), b.tMin, b.tMax), speed_pct: clamp(Math.round(speed), b.sMin, b.sMax) }
  return next
}

/** Inserts a point at (temp, speed) if there is room. Returns {points, index} or null. */
export function insertPoint(points, temp, speed, c = DEFAULT_CONSTRAINTS) {
  if (points.length >= c.points_max) return null
  const t = Math.round(temp)
  if (t < c.temp_min_c || t > c.temp_max_c || points.some((p) => p.temp_c === t)) return null
  let i = points.findIndex((p) => p.temp_c > t)
  if (i === -1) i = points.length
  const lo = points[i - 1]
  const hi = points[i]
  const s = clamp(Math.round(speed), lo ? lo.speed_pct : 0, hi ? hi.speed_pct : 100)
  const next = points.slice()
  next.splice(i, 0, { temp_c: t, speed_pct: s })
  return { points: next, index: i }
}

/** Removes point i if the curve keeps its minimum length. Returns a new array or null. */
export function removePoint(points, i, c = DEFAULT_CONSTRAINTS) {
  if (points.length <= c.points_min) return null
  return points.filter((_, j) => j !== i)
}
