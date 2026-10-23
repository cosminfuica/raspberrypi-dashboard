// The Network Section: the interfaces with their sparklines, and the throughput chart of the chosen one.
import { Wifi, EthernetPort, Waypoints, Network, Container } from 'lucide'
import { Chart } from '../ui/charts.js'
import { fmt } from '../ui/format.js'
import { section, el, setText, esc, ico, badge, badgeHTML, syncList, radioGroup, setChecked } from '../ui/dom.js'
import { S, hts } from '../shell/state.js'

export function createNetwork() {
  const NET = section('network')
  let netSel = 'total'
  const netIcon = { wifi: Wifi, ethernet: EthernetPort, vpn: Waypoints, bridge: Container, other: Network }
  const netRX = () => (netSel === 'total' ? S.hist?.series.net_rx_bytes_per_s : S.hist?.net[netSel]?.rx)
  const netTX = () => (netSel === 'total' ? S.hist?.series.net_tx_bytes_per_s : S.hist?.net[netSel]?.tx)
  const netChart = new Chart(NET.r.chart, {
    ts: hts,
    series: [
      { get: netRX, color: '#6fc3d1', fill: 'rgba(111,195,209,0.16)', width: 1.8, label: 'Down', fmt: fmt.rate },
      { get: netTX, color: '#e8ece4', width: 1.5, label: 'Up', fmt: fmt.rate },
    ],
    bytes: true,
    floor: 16 * 1024,
    ticks: (lo, hi) => [0, hi / 2, hi],
    tickFmt: (v) => fmt.rate(v),
  })
  const sparks = new Map()
  radioGroup(NET.r.ifaces, (v) => {
    netSel = v
    setChecked(NET.r.ifaces, v)
    netChart.invalidate(true)
    renderNetCaption()
  })
  function renderNetCaption() {
    setText(
      NET.r.cap,
      netSel === 'total' ? 'Wi-Fi + Ethernet throughput, last 10 minutes' : `${netSel} throughput, last 10 minutes`,
    )
  }
  function renderNetwork() {
    const n = S.m.network
    if (!n) return
    const rows = [
      {
        name: 'total',
        kind: 'total',
        up: true,
        addresses: [],
        rx_bytes_per_s: n.total.rx_bytes_per_s,
        tx_bytes_per_s: n.total.tx_bytes_per_s,
      },
      ...n.interfaces,
    ]
    syncList(
      NET.r.ifaces,
      rows,
      (i) => i.name,
      (i) => {
        const b = el(`<button type="button" class="iface" role="radio" data-v="${esc(i.name)}">
        ${ico(i.kind === 'total' ? Network : netIcon[i.kind] || Network)}
        <span class="iface-name"><span data-k="name"></span>${badgeHTML('st')}</span>
        <span class="iface-addr" data-k="addr"></span>
        <span class="iface-rates"><span class="rx" data-k="rx"></span><span class="tx" data-k="tx"></span></span>
        <canvas aria-hidden="true"></canvas>
      </button>`)
        const name = i.name
        sparks.set(
          name,
          new Chart(b.querySelector('canvas'), {
            mini: true,
            ts: hts,
            window: () => 120,
            bytes: true,
            floor: 4096,
            series: [
              {
                get: () => (name === 'total' ? S.hist?.series.net_rx_bytes_per_s : S.hist?.net[name]?.rx),
                color: '#6fc3d1',
                fill: 'rgba(111,195,209,0.3)',
                width: 1,
              },
              {
                get: () => (name === 'total' ? S.hist?.series.net_tx_bytes_per_s : S.hist?.net[name]?.tx),
                color: '#e8ece4',
                width: 1,
              },
            ],
          }),
        )
        return b
      },
      (b, i) => {
        setText(b.querySelector('[data-k=name]'), i.name === 'total' ? 'All traffic' : i.name)
        const st = b.querySelector('[data-ref=st]')
        if (i.kind === 'total') {
          st.hidden = true
          setText(b.querySelector('[data-k=addr]'), 'Wi-Fi + Ethernet (Tailscale runs inside them)')
        } else {
          st.hidden = false
          badge(st, i.up ? 'ok' : 'off', i.up ? 'up' : 'down')
          const link =
            i.wifi_signal_dbm != null
              ? `${i.wifi_signal_dbm} dBm`.replace('-', '\u2212')
              : i.speed_mbps
                ? `${i.speed_mbps} Mb/s`
                : null
          setText(
            b.querySelector('[data-k=addr]'),
            [link, ...i.addresses].filter(Boolean).join(' · ') || (i.up ? 'no address' : 'no link'),
          )
        }
        b.toggleAttribute('data-down', !i.up)
        // the arrows come from styles/network.css (spoken as "down" and "up"), so the button's name is exactly its visible text
        setText(b.querySelector('[data-k=rx]'), fmt.rate(i.rx_bytes_per_s))
        setText(b.querySelector('[data-k=tx]'), fmt.rate(i.tx_bytes_per_s))
      },
    )
    if (!rows.some((r) => r.name === netSel)) netSel = 'total'
    setChecked(NET.r.ifaces, netSel)
    const up = n.interfaces.filter((i) => i.up).length
    setText(
      NET.r.sum,
      `${up} of ${n.interfaces.length} interfaces up · ↓ ${fmt.rate(n.total.rx_bytes_per_s)} · ↑ ${fmt.rate(n.total.tx_bytes_per_s)}`,
    )
    for (const c of sparks.values()) c.invalidate()
  }
  renderNetCaption()
  return { renderNetwork, sparks }
}
