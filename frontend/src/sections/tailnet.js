// The Tailnet Section: this Pi in the tailnet, its addresses to copy, and the peers.
import { Copy } from 'lucide'
import { fmt } from '../ui/format.js'
import { section, dnp, el, setText, esc, ico, badge, badgeHTML, syncList, copyText } from '../ui/dom.js'
import { levels } from '../health/verdict.js'
import { S } from '../shell/state.js'

export function createTailnet() {
  const TS = section('tailnet')
  const connTone = {
    direct: ['ok', 'Direct'],
    relay: ['warn', 'Relayed'],
    idle: ['info', 'Idle'],
    offline: ['off', 'Offline'],
  }
  TS.r.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.ip')
    if (!b) return
    const ok = await copyText(b.dataset.ip)
    b.dataset.copied = ''
    const label = b.querySelector('span')
    const old = label.textContent
    label.textContent = ok ? 'Copied' : 'Copy failed'
    setTimeout(() => {
      delete b.dataset.copied
      label.textContent = old
    }, 1200)
  })
  function renderTailscale() {
    const t = S.m.tailscale
    if (!t) return
    if (!t.available) {
      TS.root.toggleAttribute('data-dnp', true)
      TS.r.dnp.hidden = false
      TS.r.dnp.innerHTML = dnp(`Tailscale status unavailable: ${t.error}`)
      setText(TS.r.sum, null)
      return
    }
    TS.root.toggleAttribute('data-dnp', false)
    TS.r.dnp.hidden = true
    setText(TS.r.sum, `${t.summary.online} of ${t.summary.peers} peers online · v${t.version}`)
    const self = t.self
    const now = S.m.ts ?? Date.now() / 1000
    const left = self.key_expiry == null ? null : self.key_expiry - now
    const html = `
    <div class="ts-name"><b>${esc(self.hostname)}</b>${badgeHTML('st')}</div>
    <div class="ips">${self.ips.map((ip) => `<button type="button" class="ip" data-ip="${esc(ip)}" title="Copy ${esc(ip)}">${ico(Copy)}<span>${esc(ip)}</span></button>`).join('')}</div>
    <dl class="kv">
      <div><dt>MagicDNS</dt><dd title="${esc(self.dns_name)}">${esc(self.dns_name)}</dd></div>
      <div><dt>Key expires</dt><dd>${left == null ? 'Never' : `${fmt.date(self.key_expiry)} (${left > 0 ? `in ${fmt.dur(left)}` : 'expired'})`}</dd></div>
      <div><dt>Home relay</dt><dd>${esc(self.relay ?? '—')}</dd></div>
      <div><dt>State</dt><dd>${esc(t.backend_state)}</dd></div>
    </dl>`
    if (TS.r.self._h !== html) {
      TS.r.self._h = html
      TS.r.self.innerHTML = html
    }
    badge(
      TS.r.self.querySelector('[data-ref=st]'),
      levels.tailscale(t), // the Verdict's level: Offline in the tailnet has its Reason (plan fix b)
      t.backend_state === 'Running' ? (self.online ? 'Online' : 'Offline') : t.backend_state,
    )
    syncList(
      TS.r.peers,
      t.peers,
      (p) => p.dns_name || p.hostname,
      () => el(`<li><span class="peer-name"></span>${badgeHTML('st')}<span class="peer-meta"></span></li>`),
      (li, p) => {
        setText(li.querySelector('.peer-name'), p.hostname)
        const [tone, label] = connTone[p.connection] || ['off', p.connection]
        badge(li.querySelector('[data-ref=st]'), tone, p.connection === 'relay' ? `Relayed via ${p.relay}` : label)
        const bits = [p.os, p.ips[0]]
        if (p.online) bits.push(`↓ ${fmt.bytes(p.rx_bytes)} · ↑ ${fmt.bytes(p.tx_bytes)}`)
        else if (p.last_seen) bits.push(`last seen ${fmt.dur(now - p.last_seen)} ago`)
        if (p.exit_node) bits.push('exit node')
        setText(li.querySelector('.peer-meta'), bits.filter(Boolean).join(' · '))
      },
    )
  }
  return { renderTailscale }
}
