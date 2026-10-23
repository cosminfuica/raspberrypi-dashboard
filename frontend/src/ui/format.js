// Every displayed number and unit. Kept out of ui/dom.js and ui/prefs.js, which need browser globals at import, so node tests can load it.
export const NB = '\u00a0' // no-break space between a number and its unit (Archivo has no U+202F)
const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

export const fmt = {
  temp: (c, d = 1) => (c == null ? '—' : `${c.toFixed(d)}${NB}°C`),
  deg: (c) => (c == null ? '—' : `${c.toFixed(1)}°`),
  pct: (p, d = 1) => (p == null ? '—' : `${p.toFixed(d)}${NB}%`),
  int: (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US')),
  fixed: (n, d) => (n == null ? '—' : n.toFixed(d)),
  bytes(b) {
    if (b == null) return '—'
    let i = 0
    let v = Math.abs(b)
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024
      i++
    }
    const d = i === 0 || v >= 100 ? 0 : 1
    return `${(Math.sign(b) * v).toFixed(d)}${NB}${units[i]}`
  },
  rate: (b) => (b == null ? '—' : `${fmt.bytes(b)}/s`),
  mhz: (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)}${NB}GHz` : `${Math.round(m)}${NB}MHz`),
  dur(s, withSeconds = false) {
    if (s == null) return '—'
    s = Math.max(0, Math.floor(s))
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (d) return h ? `${d}${NB}d ${h}${NB}h` : `${d}${NB}d`
    if (h) return `${h}${NB}h ${m}${NB}min`
    if (m) return withSeconds ? `${m}${NB}min ${sec}${NB}s` : `${m}${NB}min`
    return `${sec}${NB}s`
  },
  date: (ts) =>
    ts == null
      ? '—'
      : new Date(ts * 1000).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
  clock: (ts) => (ts == null ? '—' : new Date(ts * 1000).toLocaleTimeString(undefined, { hour12: false })),
}
