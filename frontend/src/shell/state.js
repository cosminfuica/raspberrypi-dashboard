// The page's state: the merged metrics snapshot, the History arrays and the Pi's clock offset.
import { SERIES } from '../link/series.js'

export const S = {
  info: null,
  profiles: null,
  m: {}, // merged metrics snapshot
  hist: null, // {ts, series, net}
  lastTs: 0,
  offsetS: 0, // server clock − browser clock
  link: 'connecting',
  stale: false,
  last: null, // the last real verdict {level, headline, ts} (verdict.js), for the No contact row
}
export const HIST_MAX = 600

export function applyHistory(h) {
  S.hist = { ts: h.ts.slice(), series: {}, net: {} }
  for (const [k, a] of Object.entries(h.series)) S.hist.series[k] = a.slice()
  for (const [k, v] of Object.entries(h.net || {}))
    S.hist.net[k] = { rx: v.rx_bytes_per_s.slice(), tx: v.tx_bytes_per_s.slice() }
  S.lastTs = h.ts[h.ts.length - 1] ?? 0
}

export function appendHistory(m) {
  const H = S.hist
  if (!H || m.ts <= S.lastTs) return
  S.lastTs = m.ts
  H.ts.push(m.ts)
  for (const [k, f] of Object.entries(SERIES))
    (H.series[k] ||= new Array(H.ts.length - 1).fill(null)).push(f(m) ?? null)
  const seen = new Set()
  for (const i of m.network?.interfaces || []) {
    const n = (H.net[i.name] ||= {
      rx: new Array(H.ts.length - 1).fill(null),
      tx: new Array(H.ts.length - 1).fill(null),
    })
    n.rx.push(i.rx_bytes_per_s)
    n.tx.push(i.tx_bytes_per_s)
    seen.add(i.name)
  }
  for (const [k, n] of Object.entries(H.net))
    if (!seen.has(k)) {
      n.rx.push(null)
      n.tx.push(null)
    }
  if (H.ts.length > HIST_MAX) {
    const cut = H.ts.length - HIST_MAX
    H.ts.splice(0, cut)
    for (const a of Object.values(H.series)) a.splice(0, cut)
    for (const n of Object.values(H.net)) {
      n.rx.splice(0, cut)
      n.tx.splice(0, cut)
    }
  }
}
export const hts = () => S.hist?.ts
export const hs = (k) => () => S.hist?.series[k]
export const dataAge = () => (S.lastTs ? Date.now() / 1000 + S.offsetS - S.lastTs : performance.now() / 1000)
