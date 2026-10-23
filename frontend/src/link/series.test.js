// Checks series.js, the history series the page and the Demo share. Run with `node src/link/series.test.js`.
import assert from 'node:assert/strict'
import { example } from './api-examples.js'
import { SERIES } from './series.js'

// The backend's SERIES (app.py) is pinned to this example by test_api.py, so this pins the page to the backend.
assert.deepEqual(Object.keys(SERIES), Object.keys(example('### GET /api/history').series))

const m = example('### GET /api/metrics')
for (const [k, f] of Object.entries(SERIES)) {
  const v = f(m)
  assert.ok(v === null || typeof v === 'number', `${k} gives a number or null, got ${v}`)
}
// the fixture has fan and power available, so these two read real numbers
assert.equal(typeof SERIES.fan_rpm(m), 'number')
assert.equal(typeof SERIES.pmic_w(m), 'number')

// "Sections with optional sources report available: false with an error string" (API.md): no number to read
const off = {
  ...m,
  fan: { available: false, error: 'no hwmon device named pwmfan' },
  power: { available: false, error: 'x' },
}
for (const k of ['fan_rpm', 'fan_pct', 'pmic_w'])
  assert.equal(SERIES[k](off), null, `${k} is null when its source is off`)

console.log('series.js: all checks passed')
