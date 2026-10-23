// Checks format.js, the one place numbers and units become text. Run with `npm test`.
import assert from 'node:assert/strict'
import { fmt, NB } from './format.js'

// The literal, not the import: the no-break space before a unit is what the page shows (Archivo has no U+202F)
const nb = '\u00a0'
assert.equal(NB, nb)

for (const f of [fmt.temp, fmt.pct, fmt.int, fmt.bytes, fmt.dur]) assert.equal(f(null), '—')

assert.equal(fmt.temp(45.678), `45.7${nb}°C`)
assert.equal(fmt.temp(45.678, 0), `46${nb}°C`)

assert.equal(fmt.pct(12.34), `12.3${nb}%`)
assert.equal(fmt.pct(12.34, 0), `12${nb}%`)

assert.equal(fmt.int(1234567.4), '1,234,567')
assert.equal(fmt.int(0), '0')

assert.equal(fmt.bytes(0), `0${nb}B`)
assert.equal(fmt.bytes(1023), `1023${nb}B`)
assert.equal(fmt.bytes(1536), `1.5${nb}KiB`)
assert.equal(fmt.bytes(5 * 1024 ** 2), `5.0${nb}MiB`)
assert.equal(fmt.bytes(150 * 1024 ** 2), `150${nb}MiB`)
assert.equal(fmt.bytes(3 * 1024 ** 3), `3.0${nb}GiB`)
assert.equal(fmt.bytes(-2048), `-2.0${nb}KiB`)

assert.equal(fmt.dur(45), `45${nb}s`)
assert.equal(fmt.dur(45, true), `45${nb}s`)
assert.equal(fmt.dur(125), `2${nb}min`)
assert.equal(fmt.dur(125, true), `2${nb}min 5${nb}s`)
assert.equal(fmt.dur(3700), `1${nb}h 1${nb}min`)
assert.equal(fmt.dur(3700, true), `1${nb}h 1${nb}min`)
assert.equal(fmt.dur(90000), `1${nb}d 1${nb}h`)
assert.equal(fmt.dur(86400), `1${nb}d`)
assert.equal(fmt.dur(-5), `0${nb}s`)

console.log('format.js: all checks passed')
