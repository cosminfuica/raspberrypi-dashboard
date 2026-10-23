// The Power Section: the SoC power reading, its chart and the PMIC rails.
import { Chart } from '../ui/charts.js'
import { fmt } from '../ui/format.js'
import { section, dnp, tweenText, el, setText, syncList } from '../ui/dom.js'
import { S, hts, hs } from '../shell/state.js'

export function createPower() {
  const PW = section('power')
  new Chart(PW.r.chart, {
    ts: hts,
    series: [
      {
        get: hs('pmic_w'),
        color: '#e8ece4',
        fill: 'rgba(232,236,228,0.14)',
        label: 'SoC power',
        fmt: (v) => (v == null ? '—' : `${v.toFixed(2)} W`),
      },
    ],
    floor: 2,
    ticks: (lo, hi) => [0, hi / 2, hi],
    tickFmt: (v) => `${+v.toFixed(1)} W`,
  })
  function renderPower() {
    const p = S.m.power
    if (!p) return
    const box = PW.root
    if (!p.available) {
      box.toggleAttribute('data-dnp', true)
      PW.r.dnp.hidden = false
      PW.r.dnp.innerHTML = dnp(`Power readings unavailable: ${p.error}`)
      return
    }
    box.toggleAttribute('data-dnp', false)
    PW.r.dnp.hidden = true
    tweenText(PW.r.w, p.pmic_w, (v) => v.toFixed(2))
    setText(PW.r.in, p.input_v == null ? null : `${p.input_v.toFixed(3)} V`)
    setText(PW.r.core, `${fmt.fixed(p.core_v, 3)} V · ${fmt.fixed(p.core_a, 2)} A`)
    const max = Math.max(...p.rails.map((r) => r.w), 0.001)
    syncList(
      PW.r.rails,
      p.rails,
      (r) => r.name,
      () => el('<li><span></span><i></i><span></span></li>'),
      (li, r) => {
        setText(li.firstChild, r.name)
        li.children[1].style.setProperty('--p', `${((r.w / max) * 100).toFixed(1)}%`)
        setText(li.lastChild, `${r.w.toFixed(3)} W`)
        li.title = `${r.v.toFixed(3)} V × ${r.a.toFixed(3)} A`
      },
    )
  }
  return { renderPower }
}
