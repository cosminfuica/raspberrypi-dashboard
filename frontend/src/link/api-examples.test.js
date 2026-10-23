// Checks api-examples.js, the node-only reader for the json examples in backend/tests/API.md. Run with `node src/link/api-examples.test.js`.
import assert from 'node:assert/strict'
import { example } from './api-examples.js'

const metrics = example('### GET /api/metrics')
for (const key of ['ts', 'cpu', 'temps', 'fan']) assert.ok(key in metrics, `GET /api/metrics example has ${key}`)

// n picks the n-th json block after the heading: 0 is the request, 1 the documented response
assert.deepEqual(example('**`PUT /api/fan/night`**', 1), {
  night: { enabled: true, profile: 'silent', start: '23:00', end: '07:00' },
  profile: 'silent',
  schedule: 'night',
})

assert.throws(
  () => example('### no such heading'),
  (e) => e instanceof Error && e.message.includes('### no such heading'),
)

console.log('api-examples.test.js ok')
