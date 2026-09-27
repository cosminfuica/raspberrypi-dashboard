// Generates src/traces.svg: the copper-under-solder-mask texture behind the dashboard.
// Deterministic (seeded) so rebuilds don't churn the asset. Run: node scripts/traces.mjs > src/traces.svg
const W = 720
const G = 12 // routing grid, px
const N = W / G
let seed = 0x5eed
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const used = new Set()
const key = (x, y) => `${x},${y}`
const free = (x, y) => x > 1 && y > 1 && x < N - 2 && y < N - 2 && !used.has(key(x, y))

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
const paths = []
const vias = []

// One trace: runs straight, bends by 45° now and then, ends on a via. Cells it crosses are reserved (with a margin).
function route(x, y, d, len) {
  const pts = [[x, y]]
  const cells = [[x, y]]
  for (let i = 0; i < len; i++) {
    if (i > 2 && rnd() < 0.18) d = (d + pick([1, 7])) % 8
    const [dx, dy] = DIRS[d]
    const nx = x + dx
    const ny = y + dy
    if (!free(nx, ny)) break
    x = nx
    y = ny
    const last = pts[pts.length - 1]
    if (pts.length > 1) {
      const prev = pts[pts.length - 2]
      const pd = [Math.sign(last[0] - prev[0]), Math.sign(last[1] - prev[1])]
      if (pd[0] === dx && pd[1] === dy) pts.pop()
    }
    pts.push([x, y])
    cells.push([x, y])
  }
  if (cells.length < 5) return false
  for (const [cx, cy] of cells) for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) used.add(key(cx + ox, cy + oy))
  paths.push(pts)
  vias.push(pts[pts.length - 1])
  if (rnd() < 0.5) vias.push(pts[0])
  return true
}

// Buses: 3-5 parallel traces leaving together.
for (let b = 0; b < 9; b++) {
  const n = 3 + Math.floor(rnd() * 3)
  const d = pick([0, 2, 4, 6])
  const [px, py] = DIRS[(d + 2) % 8]
  const x0 = 4 + Math.floor(rnd() * (N - 8))
  const y0 = 4 + Math.floor(rnd() * (N - 8))
  const len = 14 + Math.floor(rnd() * 26)
  const s = seed
  for (let i = 0; i < n; i++) {
    seed = s // identical bend decisions keep the bus parallel
    route(x0 + px * i * 2, y0 + py * i * 2, d, len)
  }
}
for (let i = 0; i < 26; i++) route(2 + Math.floor(rnd() * (N - 4)), 2 + Math.floor(rnd() * (N - 4)), Math.floor(rnd() * 8), 6 + Math.floor(rnd() * 20))

const p = (v) => v * G + G / 2
const d = paths.map((pts) => 'M' + pts.map(([x, y]) => `${p(x)} ${p(y)}`).join('L')).join('')
const v = vias.map(([x, y]) => `<circle cx="${p(x)}" cy="${p(y)}" r="3.2"/>`).join('')
process.stdout.write(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">` +
    `<path d="${d}" fill="none" stroke="#12261d" stroke-width="2" stroke-linejoin="round"/>` +
    `<g fill="#08120e" stroke="#183126" stroke-width="1.6">${v}</g></svg>\n`,
)
