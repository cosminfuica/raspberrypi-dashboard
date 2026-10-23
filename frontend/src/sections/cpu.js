// The CPU Section: per-core bars, CPU time, the CPU chart and the process table.
import { Chart } from '../ui/charts.js'
import { fmt } from '../ui/format.js'
import { section, tweenText, el, setText, syncList, flip, radioGroup, setChecked } from '../ui/dom.js'
import { clamp } from '../ui/palette.js'
import { S, hts, hs } from '../shell/state.js'

export function createCpu() {
  const CPU = section('cpu')
  {
    const cores = CPU.r.cores
    cores.innerHTML = [0, 1, 2, 3]
      .map(
        (i) =>
          `<div class="core" role="listitem"><div class="core-bar" aria-hidden="true"><i></i></div><span class="core-lab">core ${i}<b>—</b></span></div>`,
      )
      .join('')
  }
  const TIMES = [
    ['user', 'User', '#e8ece4'],
    ['system', 'System', '#6fc3d1'],
    ['iowait', 'I/O wait', '#d9b35d'],
    ['softirq', 'IRQ', '#8a9a90'],
  ]
  CPU.r.times.innerHTML = TIMES.map(([k, , c]) => `<i data-k="${k}" style="background:${c}"></i>`).join('')
  CPU.r['times-legend'].innerHTML = TIMES.map(
    ([k, l, c]) => `<li><i style="background:${c}"></i>${l} <b data-k="${k}">—</b></li>`,
  ).join('')
  new Chart(CPU.r.chart, {
    ts: hts,
    series: [
      { get: hs('cpu_pct'), color: '#e8ece4', fill: 'rgba(232,236,228,0.16)', label: 'CPU', fmt: (v) => fmt.pct(v) },
    ],
    max: 100,
    ticks: () => [0, 25, 50, 75, 100],
    tickFmt: (v) => `${v}${'\u00a0'}%`,
  })
  let procKey = 'top_cpu'
  radioGroup(CPU.r['proc-sort'], (v) => {
    procKey = v
    setChecked(CPU.r['proc-sort'], v)
    renderProcs(true)
  })

  function renderCPU() {
    const c = S.m.cpu
    if (!c) return
    tweenText(CPU.r.usage, c.usage_pct, (v) => v.toFixed(1))
    const bars = CPU.r.cores.children
    c.per_core_pct.forEach((p, i) => {
      bars[i].querySelector('i').style.setProperty('--f', clamp(p, 0, 100) / 100)
      setText(bars[i].querySelector('b'), fmt.pct(p, 0))
    })
    CPU.r.cores.setAttribute(
      'aria-label',
      `Per-core usage: ${c.per_core_pct.map((p, i) => `core ${i} ${Math.round(p)} %`).join(', ')}`,
    )
    setText(CPU.r.freq, fmt.mhz(c.freq_mhz))
    setText(CPU.r.gov, c.governor)
    setText(CPU.r.load, c.load_avg.map((v) => v.toFixed(2)).join(' · '))
    for (const [k] of TIMES) {
      const v = c.times_pct[k] ?? 0
      CPU.r.times.querySelector(`[data-k=${k}]`).style.flexBasis = `${v}%`
      setText(CPU.r['times-legend'].querySelector(`[data-k=${k}]`), fmt.pct(v))
    }
    CPU.r.times.setAttribute(
      'aria-label',
      `CPU time: ${TIMES.map(([k, l]) => `${l} ${fmt.pct(c.times_pct[k])}`).join(', ')}, idle ${fmt.pct(c.times_pct.idle)}`,
    )
    setText(
      CPU.r.sum,
      `${S.info?.cpu.cores ?? 4} × ${S.info?.cpu.model ?? 'Cortex-A76'} · ${fmt.int(S.m.system?.process_count)} processes · ${fmt.int(S.m.system?.thread_count)} threads`,
    )
  }

  function renderProcs(animate = false) {
    const list = S.m.processes?.[procKey]
    if (!list) return
    const body = CPU.r.procs
    const run = () =>
      syncList(
        body,
        list,
        (p) => p.pid,
        () =>
          el(`<tr><td><span class="nm"></span><span class="cmd"></span></td>
          <td class="num" data-k="cpu"></td>
          <td class="num"><span data-k="mem"></span></td>
          <td class="num hide-sm" data-k="thr"></td><td class="hide-sm" data-k="user"></td></tr>`),
        (row, p) => {
          setText(row.querySelector('.nm'), p.name)
          const cmd = row.querySelector('.cmd')
          setText(cmd, p.command)
          cmd.title = p.command
          setText(row.querySelector('[data-k=cpu]'), fmt.pct(p.cpu_pct))
          setText(row.querySelector('[data-k=mem]'), `${fmt.bytes(p.rss_bytes)}`)
          setText(row.querySelector('[data-k=thr]'), p.threads)
          setText(row.querySelector('[data-k=user]'), p.user)
        },
      )
    flip(body, run) // flip() skips the motion under prefers-reduced-motion
  }
  return { renderCPU, renderProcs }
}
