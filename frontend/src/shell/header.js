// The header's host readings and the footer markings.
import { fmt } from '../ui/format.js'
import { bind, setText, esc } from '../ui/dom.js'
import { S } from './state.js'

export function renderHeader() {
  const i = S.info
  const m = S.m
  if (i) {
    setText(bind('hostname'), i.hostname)
    setText(bind('model'), i.model)
  }
  setText(bind('uptime'), fmt.dur(m.system?.uptime_s))
  setText(bind('load'), m.cpu ? m.cpu.load_avg.map((v) => v.toFixed(2)).join(' · ') : null)
}

export function renderMarkings() {
  const i = S.info
  if (!i) return
  const rows = [
    ['Model', i.model],
    ['CPU', `${i.cpu.cores} × ${i.cpu.model}, ${fmt.mhz(i.cpu.min_mhz)}–${fmt.mhz(i.cpu.max_mhz)}`],
    ['Memory', fmt.bytes(i.memory_total_bytes)],
    ['OS', i.os],
    ['Kernel', `${i.kernel} (${i.arch})`],
    ['Booted', fmt.date(i.boot_time)],
    ['pidash', `app ${i.app_version} · API v${i.api_version}${i.mock ? ' · mock data' : ''}`],
  ]
  bind('markings').innerHTML = rows
    .map(([k, v]) => `<div${k === 'CPU' ? ' class="wide"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join('')
}
