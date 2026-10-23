// The Thermals Section: the temperature gauges, the temperature chart and the throttle flags.
import { TriangleAlert } from 'lucide'
import { Chart } from '../ui/charts.js'
import { fmt } from '../ui/format.js'
import { section, dnp, tweenText, setText, ico, badge, badgeHTML } from '../ui/dom.js'
import { heat, T_MIN, T_MAX } from '../ui/palette.js'
import { levels, limitsOf } from '../health/verdict.js'
import { S, hts, hs } from '../shell/state.js'

export function createThermals() {
  const TH = section('thermals')
  const GAUGES = [
    {
      k: 'soc_c',
      name: 'SoC',
      sub: 'BCM2712, drives the fan curve',
      marks: (L) => [
        [L.soc_throttle_c, `${L.soc_throttle_c}° throttle`],
        [L.soc_throttle_hard_c, `${L.soc_throttle_hard_c}° hard`],
      ],
    },
    {
      k: 'nvme_c',
      name: 'NVMe',
      sub: 'WD SN580, composite',
      marks: (L) => [[L.nvme_warn_c, `${L.nvme_warn_c}° warn`]],
    },
    { k: 'rp1_c', name: 'RP1', sub: 'I/O controller', marks: () => [] },
    { k: 'pmic_c', name: 'PMIC', sub: 'power IC, updates every 5 s', marks: () => [] },
  ]
  TH.r.gauges.innerHTML = GAUGES.map(
    (g) => `<li class="gauge" data-k="${g.k}">
    <span class="gauge-name">${g.name}<small>${g.sub}</small></span>
    <span class="gauge-val"><span data-v>—</span><small>°C</small></span>
    <span class="strip" role="meter" aria-label="${g.name} temperature" aria-valuemin="${T_MIN}" aria-valuemax="${T_MAX}"></span>
  </li>`,
  ).join('')
  TH.r.gauges.insertAdjacentHTML(
    'afterend',
    `<p class="gauge-note">Scale ${T_MIN}–${T_MAX}${'\u00a0'}°C, the same heat colours as the board view.</p>`,
  )
  new Chart(TH.r.chart, {
    ts: hts,
    series: [
      { get: hs('soc_temp_c'), heat: true, width: 2, label: 'SoC', fmt: (v) => fmt.temp(v) },
      { get: hs('nvme_temp_c'), color: '#6fc3d1', width: 1.4, dash: [4, 3], label: 'NVMe', fmt: (v) => fmt.temp(v) },
    ],
    min: 30,
    max: 90,
    ticks: () => [30, 45, 60, 75, 90],
    tickFmt: (v) => `${v}°`,
    marks: () => [{ y: limitsOf(S.info?.limits).soc_throttle_c, label: 'SoC throttles', tone: 'bad' }],
  })
  const FLAGS = [
    ['under_voltage', 'Under-voltage'],
    ['arm_freq_capped', 'ARM frequency capped'],
    ['throttled', 'Throttled'],
    ['soft_temp_limit', 'Soft temperature limit'],
  ]
  TH.r['flag-rows'].innerHTML = FLAGS.map(
    ([k, l]) => `<tr data-k="${k}"><td>${l}</td><td>${badgeHTML('now')}</td><td>${badgeHTML('boot')}</td></tr>`,
  ).join('')

  function renderThermals() {
    const t = S.m.temps
    const L = limitsOf(S.info?.limits)
    if (t) {
      for (const g of GAUGES) {
        const li = TH.r.gauges.querySelector(`[data-k=${g.k}]`)
        const v = t[g.k]
        tweenText(li.querySelector('[data-v]'), v, (x) => (x == null ? '—' : x.toFixed(1)))
        const strip = li.querySelector('.strip')
        strip.style.setProperty('--p', `${(heat(v) * 100).toFixed(1)}%`)
        if (v != null) strip.setAttribute('aria-valuenow', v)
        strip.setAttribute('aria-valuetext', v == null ? 'unknown' : `${v.toFixed(1)} °C`)
        if (!strip._marks && S.info) {
          strip._marks = true
          for (const [y, label] of g.marks(L)) {
            if (y == null) continue
            const mk = document.createElement('i')
            mk.className = 'mark'
            mk.dataset.l = label
            mk.style.left = `${(heat(y) * 100).toFixed(1)}%`
            strip.append(mk)
          }
        }
      }
      const soc = t.soc_c
      setText(
        TH.r.sum,
        soc == null
          ? 'SoC temperature unavailable'
          : soc >= L.soc_throttle_c
            ? 'Throttling'
            : `${Math.max(0, Math.round(L.soc_throttle_c - soc))}${'\u00a0'}°C below the throttle point`,
      )
    }
    const th = S.m.throttling
    if (!th) return
    if (!th.available) {
      TH.r.flags.hidden = true
      TH.r.raw.textContent = '—'
      TH.r.dnp.hidden = false
      TH.r.dnp.innerHTML = dnp(`Throttle flags unavailable: ${th.error}`)
      TH.r.uv.hidden = true
      return
    }
    TH.r.flags.hidden = false
    TH.r.dnp.hidden = true
    setText(TH.r.raw, th.raw)
    for (const [k] of FLAGS) {
      const row = TH.r['flag-rows'].querySelector(`[data-k=${k}]`)
      const now = th.now[k]
      const boot = th.since_boot[k]
      // the Verdict's levels: once since boot is To check for every flag, under-voltage too (Owner decision Q1c)
      badge(row.querySelector('[data-ref=now]'), levels.flagNow(now), now ? 'Yes' : 'No')
      badge(row.querySelector('[data-ref=boot]'), levels.flagSinceBoot(k, boot), boot ? 'Seen' : 'Never')
    }
    const uv = th.now.under_voltage || th.since_boot.under_voltage
    TH.r.uv.hidden = !uv
    if (uv)
      TH.r.uv.innerHTML = `${ico(TriangleAlert)}<span>${th.now.under_voltage ? 'Under-voltage now.' : 'Under-voltage was detected since boot.'} The power supply can’t always hold 5 V. Use the official 27 W USB-C supply and a short, thick cable.</span>`
  }
  return { renderThermals }
}
