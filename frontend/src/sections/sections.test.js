// Checks sections.js, the one table of what each snapshot section redraws, against the markup (index.html), the Board
// callouts (board.js CALLOUTS) and the metrics example in backend/tests/API.md. Run with `node src/sections/sections.test.js`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { example } from '../link/api-examples.js'
import { CALLOUTS } from '../board/board.js'
import { RENDERS, derive } from './sections.js'

// main.js SECTION_RENDERS and DIM_ON_FAIL as they were before this table, copied here as the pin
const SECTION_RENDERS = {
  system: ['header'],
  cpu: ['cpu', 'header'],
  memory: ['memory'],
  temps: ['thermals'],
  throttling: ['thermals'],
  fan: [],
  disks: ['storage'],
  network: ['network'],
  processes: ['procs'],
  power: ['power'],
  services: ['services'],
  docker: ['docker'],
  tailscale: ['tailscale'],
}
const DIM_ON_FAIL = { cpu: 'cpu', memory: 'memory', temps: 'thermals', disks: 'storage', network: 'network' }

const { sectionRenders, dimOnFail } = derive(RENDERS)

// the renderers of a snapshot key are a set: their order inside a frame does not matter
assert.deepEqual(Object.keys(sectionRenders).sort(), Object.keys(SECTION_RENDERS).sort())
for (const [key, renders] of Object.entries(SECTION_RENDERS)) {
  assert.deepEqual([...sectionRenders[key]].sort(), [...renders].sort(), `sectionRenders.${key}`)
}
assert.deepEqual(dimOnFail, DIM_ON_FAIL)

// the same renderers main.js RENDER has, minus verdict (it runs on every snapshot, not from a section)
assert.deepEqual(
  RENDERS.map((r) => r.render),
  ['header', 'cpu', 'procs', 'thermals', 'power', 'memory', 'storage', 'network', 'services', 'docker', 'tailscale'],
)

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const tags = [...html.matchAll(/<section\b[^>]*>/g)].map((m) => m[0])
const sectionIds = new Set(tags.map((t) => t.match(/\sid="([^"]+)"/)?.[1]).filter(Boolean))
const idOf = (href) => href.replace(/^#/, '')

// header paints the page banner, which is no <section>; every other row names one
assert.deepEqual(
  RENDERS.filter((r) => r.section === null).map((r) => r.render),
  ['header'],
)
for (const r of RENDERS) {
  if (r.section !== null) assert.ok(sectionIds.has(r.section), `${r.render}: <section id="${r.section}"> in index.html`)
  for (const k of r.dim) assert.ok(r.from.includes(k), `${r.render}: dim key ${k} is one of its from keys`)
}

const metrics = example('### GET /api/metrics')
for (const r of RENDERS) {
  for (const k of r.from) assert.ok(k in metrics, `${r.render}: GET /api/metrics example has ${k}`)
}

for (const c of CALLOUTS) assert.ok(sectionIds.has(idOf(c.href)), `CALLOUTS ${c.part}: ${c.href} names a <section id>`)

const callouts = new Set(CALLOUTS.map((c) => c.part))
for (const t of tags) {
  const part = t.match(/\sdata-part="([^"]+)"/)?.[1]
  if (part)
    assert.ok(
      callouts.has(part),
      `${t.match(/\sid="([^"]+)"/)?.[1] ?? 'section'}: data-part ${part} is a CALLOUTS part`,
    )
}

const nav = html.match(/<nav class="fingers"[\s\S]*?<\/nav>/)[0]
const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
assert.ok(hrefs.length > 0, 'the .fingers nav has links')
for (const h of hrefs) assert.ok(sectionIds.has(idOf(h)), `.fingers ${h} names a <section id>`)

console.log('sections.js: all checks passed')
