// Run with `npm test`. Checks the curve maths the editor preview and the demo simulator rely on.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_CONSTRAINTS,
  speedAt,
  step,
  validateCurve,
  movePoint,
  insertPoint,
  removePoint,
  guard,
  nightBegan,
  nightState,
  validateNight,
  pwmOf,
} from './curve.js'

// backend/tests/fan_vectors.json: every want was produced by backend fan.py, and backend test_vectors.Vectors runs the
// same file there, so a drift on either side fails a test.
const V = JSON.parse(readFileSync(new URL('../../backend/tests/fan_vectors.json', import.meta.url), 'utf8'))
const C = V.constraints
const close = (a, b) => Math.abs(a - b) < 1e-9

assert.deepEqual(DEFAULT_CONSTRAINTS, C, 'curve.js DEFAULT_CONSTRAINTS = fan.py CONSTRAINTS')
for (const v of V.speed_at)
  assert.ok(close(speedAt(V.curves[v.curve].points, v.t), v.want), `speed_at ${v.curve} ${v.t}: ${v.want}`)
// ticks: next_target alone (always 'curve'); failsafe_ticks: FanController.step, with the 80/75 °C failsafe
for (const v of [...V.ticks, ...V.failsafe_ticks]) {
  let s = null
  v.temps.forEach((t, i) => {
    s = step(s, V.curves[v.curve], t, C, V.limits)
    const [mode, target] = v.want[i]
    assert.ok(s.mode === mode && close(s.target, target), `${v.curve} tick ${i} at ${t}: ${s.mode} ${s.target}`)
  })
}
for (const v of V.validate_curve)
  assert.deepEqual(
    validateCurve(v.body, C),
    v.want && { code: v.want[0], message: v.want[1] },
    `validate_curve ${JSON.stringify(v.body)}`,
  )
// An ISO string without Z is local time, as the server's naive datetime; no vector sits in a DST gap.
for (const v of V.night_began) assert.equal(nightBegan(v.night, new Date(v.now)), v.want, `night_began ${v.now}`)
for (const v of V.applied) {
  const { profile, schedule } = nightState(v.active, v.night, v.skip, new Date(v.now))
  assert.deepEqual([profile, schedule], v.want, `applied ${JSON.stringify(v)}`)
}
for (const v of V.validate_night)
  assert.deepEqual(
    validateNight(v.body, V.profile_ids),
    v.want && { code: v.want[0], message: v.want[1] },
    `validate_night ${JSON.stringify(v.body)}`,
  )
for (const v of V.pwm) assert.equal(pwmOf(v.target), v.want, `pwm of ${v.target} %`)

const balanced = V.curves.balanced

assert.equal(guard(3, 20), 20)
assert.equal(guard(0, 20), 0)
assert.equal(step(null, balanced, 54.1, { ...C, min_running_pct: 20 }).target, 20, 'guard follows the live constraint')

// Failsafe at 80 °C, held until below 75 °C, with the default limits.
let s = step(null, balanced, 60)
s = step(s, balanced, 80)
assert.equal(s.mode, 'failsafe')
s = step(s, balanced, 76)
assert.equal(s.mode, 'failsafe')
s = step(s, balanced, 74.9)
assert.equal(s.mode, 'curve')
assert.equal(step(null, balanced, null).mode, 'failsafe', 'unreadable temperature')

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
assert.equal(
  removePoint(
    [
      { temp_c: 20, speed_pct: 0 },
      { temp_c: 80, speed_pct: 100 },
    ],
    0,
  ),
  null,
  'keeps 2 points',
)

console.log('curve.js: all checks passed')
