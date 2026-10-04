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

// The night schedule, as backend fan.py night_began, effective_profile and validate_night have it: the window is local
// wall-clock time, and a pick inside tonight's window pauses it until its next start (`skip` = the local date it began on).
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const pad2 = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
// ponytail: Python's repr for plain strings only; a value holding a quote, a backslash or a non-printable character is
// quoted differently than the server does. Upgrade: a full repr if the demo ever needs those messages.
const repr = (s) => `'${s}'`

/** docs/API.md "PUT /api/fan/night": the local YYYY-MM-DD the night window holding `d` began on, or null outside it. */
export function nightBegan(night, d) {
  const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const { start, end } = night
  if (start < end) return start <= t && t < end ? localDate(d) : null // inside one day, e.g. 13:00-15:00
  if (t >= start) return localDate(d) // across midnight, before midnight
  return t < end ? localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12)) : null // after midnight (noon: never in a DST gap)
}

/** docs/API.md "PUT /api/fan/night": {profile, schedule} the loop applies at `d`; schedule null (off), 'day', 'night' or 'skipped'. */
export function nightState(active, night, skip, d = new Date()) {
  if (!night.enabled) return { profile: active, schedule: null }
  const began = nightBegan(night, d)
  if (began == null) return { profile: active, schedule: 'day' }
  if (skip === began) return { profile: active, schedule: 'skipped' }
  return { profile: night.profile, schedule: 'night' }
}

/** docs/API.md "PUT /api/fan/night": the server's 422 checks, in its order. Returns null when valid, else {code, message}. */
export function validateNight(body, ids) {
  const keys = ['enabled', 'profile', 'start', 'end']
  if (typeof body !== 'object' || body === null || !keys.every((k) => k in body)) // a JSON array never has these keys
    return { code: 'invalid_request', message: 'expected an object with enabled, profile, start and end' }
  if (typeof body.enabled !== 'boolean' || !keys.slice(1).every((k) => typeof body[k] === 'string'))
    return { code: 'invalid_request', message: 'enabled must be true or false, and profile, start and end strings' }
  if (!ids.includes(body.profile))
    return { code: 'invalid_night', message: `profile must be one of ${ids.join(', ')} (got ${repr(body.profile)})` }
  for (const k of ['start', 'end'])
    if (!HHMM.test(body[k])) return { code: 'invalid_night', message: `${k} must be a 24-hour time HH:MM (got ${repr(body[k])})` }
  if (body.start === body.end) return { code: 'invalid_night', message: `start and end must differ (both ${body.start})` }
  return null
}
