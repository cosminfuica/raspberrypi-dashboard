// Run with `npm test`. Checks the curve maths the editor preview and the demo simulator rely on.
import assert from 'node:assert/strict'
import { speedAt, step, validateCurve, movePoint, insertPoint, removePoint, guard, nightBegan, nightState, validateNight } from './curve.js'

const balanced = {
  hysteresis_c: 5,
  points: [
    { temp_c: 54, speed_pct: 0 },
    { temp_c: 55, speed_pct: 30 },
    { temp_c: 63, speed_pct: 50 },
    { temp_c: 70, speed_pct: 70 },
    { temp_c: 75, speed_pct: 100 },
  ],
}

// Interpolation, flat beyond the ends.
assert.equal(speedAt(balanced.points, 20), 0)
assert.equal(speedAt(balanced.points, 55), 30)
assert.equal(speedAt(balanced.points, 59), 40)
assert.equal(speedAt(balanced.points, 90), 100)
assert.equal(guard(3, 20), 20)
assert.equal(guard(0, 20), 0)

// API.md: Balanced switches on just above 54 °C and only turns off again at 49 °C.
let s = step(null, balanced, 54.1)
assert.equal(s.target, 8, 'stall guard lifts the first few percent to min_running_pct (8)')
assert.equal(step(null, balanced, 54.1, { ...balanced, min_running_pct: 20 }).target, 20, 'guard follows the live constraint')
s = step(s, balanced, 56)
for (const t of [53, 51, 50]) {
  s = step(s, balanced, t)
  assert.ok(s.target > 0, `still spinning at ${t} °C`)
}
s = step(s, balanced, 49)
assert.equal(s.target, 0, 'off at 49 °C')

// Failsafe at 80 °C, held until below 75 °C.
s = step(s, balanced, 80)
assert.equal(s.mode, 'failsafe')
s = step(s, balanced, 76)
assert.equal(s.mode, 'failsafe')
s = step(s, balanced, 74.9)
assert.equal(s.mode, 'curve')
assert.equal(step(null, balanced, null).mode, 'failsafe', 'unreadable temperature')

// Validation mirrors the server's messages.
assert.equal(validateCurve(balanced), null)
assert.equal(
  validateCurve({ hysteresis_c: 2, points: [{ temp_c: 45, speed_pct: 0 }, { temp_c: 60, speed_pct: 30 }, { temp_c: 60, speed_pct: 60 }] }),
  'points[2].temp_c must be greater than points[1].temp_c (60 <= 60)',
)
assert.match(validateCurve({ hysteresis_c: 11, points: balanced.points }), /hysteresis_c/)
assert.match(validateCurve({ hysteresis_c: 2, points: [{ temp_c: 40, speed_pct: 50 }] }), /2 to 8 points/)
assert.match(validateCurve({ hysteresis_c: 2, points: [{ temp_c: 40, speed_pct: 50 }, { temp_c: 50, speed_pct: 40 }] }), /speed_pct/)

// Editing can never produce an invalid curve.
let p = movePoint(balanced.points, 1, 70, 90)
assert.deepEqual(p[1], { temp_c: 62, speed_pct: 50 }, 'clamped between neighbours')
assert.equal(validateCurve({ hysteresis_c: 5, points: p }), null)
p = movePoint(balanced.points, 0, 5, -10)
assert.deepEqual(p[0], { temp_c: 20, speed_pct: 0 })
const ins = insertPoint(balanced.points, 66.6, 10)
assert.equal(ins.index, 3)
assert.deepEqual(ins.points[3], { temp_c: 67, speed_pct: 50 })
assert.equal(validateCurve({ hysteresis_c: 5, points: ins.points }), null)
assert.equal(insertPoint(balanced.points, 55, 40), null, 'no duplicate temperatures')
assert.equal(removePoint([{ temp_c: 20, speed_pct: 0 }, { temp_c: 80, speed_pct: 100 }], 0), null, 'keeps 2 points')

// Night schedule: backend test_fan.Night's cases. Local-time constructors, as the window is wall-clock time: any TZ passes.
const night = { enabled: true, profile: 'silent', start: '23:00', end: '07:00' }
for (const [d, began] of [
  [new Date(2026, 9, 3, 22, 59), null],
  [new Date(2026, 9, 3, 23, 0), '2026-10-03'],
  [new Date(2026, 9, 4, 3, 0), '2026-10-03'],
  [new Date(2026, 9, 4, 6, 59), '2026-10-03'],
  [new Date(2026, 9, 4, 7, 0), null],
]) {
  assert.equal(nightBegan(night, d), began, `window holding ${d}`)
  const want = began ? { profile: 'silent', schedule: 'night' } : { profile: 'balanced', schedule: 'day' }
  assert.deepEqual(nightState('balanced', night, null, d), want)
}
assert.equal(nightBegan(night, new Date(2026, 2, 1, 1, 0)), '2026-02-28', 'began the day before, across a month')
const inDay = { ...night, start: '13:00', end: '15:00' }
for (const [h, m, schedule] of [[12, 59, 'day'], [13, 0, 'night'], [15, 0, 'day']])
  assert.equal(nightState('max', inDay, null, new Date(2026, 9, 3, h, m)).schedule, schedule, `${h}:${m}`)
assert.deepEqual(nightState('max', { ...night, enabled: false }, null, new Date(2026, 9, 4, 1, 0)), { profile: 'max', schedule: null })
assert.deepEqual(nightState('max', night, '2026-10-03', new Date(2026, 9, 4, 1, 0)), { profile: 'max', schedule: 'skipped' })
assert.deepEqual(
  nightState('max', night, '2026-10-03', new Date(2026, 9, 4, 23, 0)),
  { profile: 'silent', schedule: 'night' },
  'a pick pauses one night only',
)

// validateNight: the server's codes, in its order; extra keys are dropped, not refused.
const ids = ['silent', 'balanced', 'performance', 'max', 'custom']
assert.equal(validateNight({ ...night, extra: 1 }, ids), null)
for (const [b, code] of [
  [[], 'invalid_request'],
  [null, 'invalid_request'],
  [{ enabled: true, profile: 'silent', start: '23:00' }, 'invalid_request'],
  [{ ...night, enabled: 'yes' }, 'invalid_request'],
  [{ ...night, start: 700 }, 'invalid_request'],
  [{ ...night, profile: 'turbo' }, 'invalid_night'],
  [{ ...night, profile: 'kernel' }, 'invalid_night'],
  [{ ...night, start: '7:00' }, 'invalid_night'],
  [{ ...night, end: '24:00' }, 'invalid_night'],
  [{ ...night, start: '23:00:00' }, 'invalid_night'],
  [{ ...night, start: '07:00' }, 'invalid_night'],
])
  assert.equal(validateNight(b, ids)?.code, code, JSON.stringify(b))
assert.deepEqual(
  validateNight({ ...night, start: '07:00' }, ids),
  { code: 'invalid_night', message: 'start and end must differ (both 07:00)' },
  'docs/API.md example',
)
// ASCII digits only, as the server's re.ASCII pattern: Arabic-Indic ones are refused, quoted as Python's repr does
assert.deepEqual(validateNight({ ...night, start: '1\u0663:0\u0665' }, ids), {
  code: 'invalid_night',
  message: "start must be a 24-hour time HH:MM (got '1\u0663:0\u0665')",
})

console.log('curve.js: all checks passed')
