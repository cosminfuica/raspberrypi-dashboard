// Run with `npm test`. Checks the curve maths the editor preview and the demo simulator rely on.
import assert from 'node:assert/strict'
import { speedAt, step, validateCurve, movePoint, insertPoint, removePoint, guard } from './curve.js'

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

console.log('curve.js: all checks passed')
