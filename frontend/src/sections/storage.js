// The Storage Section: the disk, its read and write rates and chart, and the filesystems.
import { Chart } from '../ui/charts.js'
import { fmt } from '../ui/format.js'
import { section, tweenText, el, setText, esc, syncList } from '../ui/dom.js'
import { levels } from '../health/verdict.js'
import { S, hts, hs } from '../shell/state.js'

export function createStorage() {
  const ST = section('storage')
  new Chart(ST.r.chart, {
    ts: hts,
    series: [
      { get: hs('disk_read_bytes_per_s'), color: '#6fc3d1', label: 'Read', fmt: fmt.rate },
      {
        get: hs('disk_write_bytes_per_s'),
        color: '#e8ece4',
        fill: 'rgba(232,236,228,0.12)',
        label: 'Write',
        fmt: fmt.rate,
      },
    ],
    bytes: true,
    floor: 64 * 1024,
    ticks: (lo, hi) => [0, hi / 2, hi],
    tickFmt: (v) => fmt.rate(v),
  })
  function renderStorage() {
    const d = S.m.disks
    if (!d) return
    const dev = d.devices[0]
    ST.r.dev.innerHTML = dev
      ? `${esc(dev.model ?? dev.name)}<small>${esc(dev.name)} · ${fmt.bytes(dev.size_bytes)}${S.m.temps?.nvme_c != null ? ` · ${fmt.temp(S.m.temps.nvme_c)}` : ''}</small>`
      : 'No disk'
    tweenText(ST.r.read, d.total.read_bytes_per_s, fmt.rate)
    tweenText(ST.r.write, d.total.write_bytes_per_s, fmt.rate)
    setText(ST.r.iops, dev ? `${fmt.int(dev.read_iops)} · ${fmt.int(dev.write_iops)}` : null)
    setText(ST.r.busy, dev ? fmt.pct(dev.busy_pct) : null)
    syncList(
      ST.r.fs,
      d.filesystems,
      (f) => f.mount,
      () =>
        el(
          '<li><span><b></b> <small></small></span><span class="meter-val"></span><span class="meter"><i></i></span></li>',
        ),
      (li, f) => {
        setText(li.querySelector('b'), f.mount)
        setText(li.querySelector('small'), `${f.device} · ${f.fstype}`)
        setText(
          li.querySelector('.meter-val'),
          `${fmt.bytes(f.used_bytes)} of ${fmt.bytes(f.total_bytes)} · ${fmt.pct(f.used_pct)}`,
        )
        const bar = li.querySelector('.meter i')
        bar.style.setProperty('--f', Math.max(0.012, f.used_pct / 100))
        bar.style.background = { bad: 'var(--bad)', warn: 'var(--warn)' }[levels.fs(f.used_pct)] ?? ''
      },
    )
  }
  return { renderStorage }
}
