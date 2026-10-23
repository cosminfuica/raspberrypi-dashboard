// The Memory Section: RAM use, its breakdown bar and chart, and swap.
import { Chart } from '../ui/charts.js'
import { fmt } from '../ui/format.js'
import { section, tweenText, setText } from '../ui/dom.js'
import { clamp } from '../ui/palette.js'
import { S, hts, hs } from '../shell/state.js'

export function createMemory() {
  const MEM = section('memory')
  const MEMPARTS = [
    ['used', 'Used', '#e8ece4'],
    ['cached', 'Cache', '#6fc3d1'],
    ['buffers', 'Buffers', '#3f7f8a'],
  ]
  MEM.r.bar.innerHTML = MEMPARTS.map(([k, , c]) => `<i data-k="${k}" style="background:${c}"></i>`).join('')
  MEM.r.legend.innerHTML = [...MEMPARTS, ['free', 'Free', '#1d3d31']]
    .map(([k, l, c]) => `<li><i style="background:${c}"></i>${l} <b data-k="${k}">—</b></li>`)
    .join('')
  new Chart(MEM.r.chart, {
    ts: hts,
    series: [
      {
        get: hs('mem_used_pct'),
        color: '#e8ece4',
        fill: 'rgba(232,236,228,0.14)',
        label: 'RAM used',
        fmt: (v) => fmt.pct(v),
      },
    ],
    max: 100,
    ticks: () => [0, 50, 100],
    tickFmt: (v) => `${v}${'\u00a0'}%`,
  })
  function renderMemory() {
    const mem = S.m.memory
    if (!mem) return
    const r = mem.ram
    tweenText(MEM.r.pct, r.used_pct, (v) => v.toFixed(1))
    // the figures in <b>: silkscreen captions are uppercase, units keep their case (GiB, not GIB)
    const cap = `RAM used · <b>${fmt.bytes(r.used_bytes)}</b> of <b>${fmt.bytes(r.total_bytes)}</b>`
    if (MEM.r.cap._h !== cap) MEM.r.cap.innerHTML = MEM.r.cap._h = cap
    const parts = { used: r.used_bytes, cached: r.cached_bytes, buffers: r.buffers_bytes }
    const free = Math.max(0, r.total_bytes - r.used_bytes - r.cached_bytes - r.buffers_bytes)
    for (const [k] of MEMPARTS)
      MEM.r.bar.querySelector(`[data-k=${k}]`).style.flexBasis = `${((parts[k] / r.total_bytes) * 100).toFixed(2)}%`
    for (const [k, v] of Object.entries({ ...parts, free }))
      setText(MEM.r.legend.querySelector(`[data-k=${k}]`), fmt.bytes(v))
    MEM.r.bar.setAttribute(
      'aria-label',
      `RAM: used ${fmt.bytes(r.used_bytes)}, cache ${fmt.bytes(r.cached_bytes)}, buffers ${fmt.bytes(r.buffers_bytes)}, free ${fmt.bytes(free)}; ${fmt.bytes(r.available_bytes)} available`,
    )
    const s = mem.swap
    // a used swap or mount never draws as an empty track: at least a 3 px sliver
    MEM.r['swap-bar'].style.setProperty('--f', s.used_bytes > 0 ? Math.max(0.012, clamp(s.used_pct, 0, 100) / 100) : 0)
    setText(MEM.r.swap, s.total_bytes ? `${fmt.bytes(s.used_bytes)} of ${fmt.bytes(s.total_bytes)}` : 'none')
  }
  return { renderMemory }
}
