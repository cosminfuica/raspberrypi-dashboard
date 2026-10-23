// The Services Section: the filtered, searchable unit table, and Service restart with its confirm and outcome.
import { RotateCw, ScrollText } from 'lucide'
import { api, auth } from '../../link/net.js'
import { levels } from '../../health/verdict.js'
import { fmt } from '../../ui/format.js'
import {
  section,
  dnp,
  el,
  setText,
  esc,
  ico,
  badge,
  badgeHTML,
  syncList,
  radioGroup,
  setChecked,
} from '../../ui/dom.js'
import { S } from '../../shell/state.js'
import { dirty, wake } from '../../shell/loop.js'

// Restart (docs/API.md "System actions"): the names the backend takes, minus the units it always refuses (they power
// off or reboot the Pi, take over its console, or are the update itself). Any other refusal comes back as a message
const RESTARTABLE = /^[A-Za-z0-9][A-Za-z0-9@._:-]*[.]service$/
const REFUSED = /^(systemd-(poweroff|reboot|halt|kexec|soft-reboot|exit)|rescue|emergency|pidash-update)\.service$/
export const canRestart = (name) => RESTARTABLE.test(name) && !REFUSED.test(name)

export function createServices({ privileged, toast, logsUI, canChange }) {
  const SV = section('services')
  let svcFilter = 'all'
  const SVC_FILTERS = [
    ['all', 'All'],
    ['running', 'Running'],
    ['done', 'Done'],
    ['failed', 'Failed'],
    ['inactive', 'Inactive'],
  ]
  SV.r.filter.innerHTML = SVC_FILTERS.map(
    ([k, l]) =>
      `<button type="button" role="radio" data-v="${k}" aria-checked="${k === 'all'}" tabindex="${k === 'all' ? 0 : -1}">${l}<b data-n="${k}"></b></button>`,
  ).join('')
  radioGroup(SV.r.filter, (v) => {
    svcFilter = v
    setChecked(SV.r.filter, v)
    renderServices()
  })
  SV.r.q.addEventListener('input', () => renderServices())
  // one column: the list runs in the page, its first SVC_SHORT rows (failed, then running) until Show all
  const oneColumn = matchMedia('(max-width: 1100px)')
  const SVC_SHORT = 12
  let svcAll = false
  oneColumn.addEventListener('change', () => renderServices())
  SV.r.more.addEventListener('click', () => {
    svcAll = !svcAll
    renderServices()
    // Show fewer takes the list away from under the button: bring the section's top back, where the list starts
    if (!svcAll) SV.r.q.closest('.svc-tools').scrollIntoView({ block: 'nearest' })
  })
  SV.r.q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && SV.r.q.value) {
      SV.r.q.value = ''
      renderServices()
    }
  })
  const svcSeen = new Map() // unit → last state, to hold a highlight on changes
  // a failed unit is the one state that rates this Pi's health (levels.service); activating, reloading and stopping
  // stay badge-only (Owner decision Q1d)
  const svcTone = (u) =>
    levels.service(u)
      ? [levels.service(u), 'Failed']
      : u.active === 'active'
        ? u.sub === 'running'
          ? ['ok', 'Running']
          : ['info', u.sub === 'exited' ? 'Done' : u.sub]
        : u.active === 'activating' || u.active === 'reloading'
          ? ['warn', u.active]
          : u.active === 'deactivating'
            ? ['warn', 'Stopping']
            : ['off', 'Inactive']
  const hl = (s, q) => {
    if (!q) return esc(s)
    const i = s.toLowerCase().indexOf(q)
    return i < 0
      ? esc(s)
      : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`
  }
  // what a restart takes down with it; `drops`: the connection to this page goes too, so a network error is expected
  const RESTART_WARN = [
    [
      /^pidash\.service$/,
      'This dashboard restarts with it: the page loses its connection for a few seconds, then reconnects.',
      true,
    ],
    [
      /^tailscaled\.service$/,
      'You reach the dashboard through Tailscale: the page loses its connection for a few seconds.',
      true,
    ],
    [
      /^(NetworkManager|wpa_supplicant|networking|dhcpcd|systemd-networkd)\.service$/,
      'The Pi’s network restarts: this page, and everything else connected to the Pi, drops for a moment.',
      true,
    ],
    [/^ssh\.service$/, 'If you’re connected over SSH, your session may drop.'],
    [
      /^docker\.service$/,
      'Containers stop with it, unless Docker’s live-restore is on; only those with a restart policy start again.',
    ],
    [/^lightdm\.service$/, 'The desktop session on the Pi closes, with any apps open in it.'],
    [/^user@\d+\.service$/, 'Every user service of that login restarts, and its desktop session may close.'],
  ]
  const restarting = new Set()
  /** Restarts a unit after asking. Resolves to the outcome's {tone, msg} (null when cancelled), so the logs dialog can
   *  say it too: a toast sits under an open dialog. */
  async function restartUnit(name) {
    const u = S.m.services?.units?.find((x) => x.name === name)
    if (!u || restarting.has(name)) return null
    let outcome = null
    const say = (tone, msg, opts) => {
      outcome = { tone, msg }
      toast(tone, msg, opts)
    }
    const short = name.replace(/\.service$/, '')
    const [, warn, drops] = RESTART_WARN.find(([re]) => re.test(name)) ?? []
    const d = u.description?.toLowerCase()
    const what = d && d !== name.toLowerCase() && d !== short.toLowerCase() ? `${short} (${u.description})` : short
    await privileged(
      {
        title: `Restart ${short}?`,
        body:
          u.active === 'active' || u.active === 'reloading'
            ? `${what} stops and starts again. Anything using it is interrupted for a moment.`
            : `${what} isn’t running now, so this starts it.`,
        warn,
        ok: 'Restart',
      },
      async () => {
        restarting.add(name)
        dirty.add('services')
        wake()
        try {
          const row = await api(`/api/services/${encodeURIComponent(name)}/restart`, { method: 'POST', timeout: 45000 })
          // the row as it is now, until the next tick brings the whole list
          const units = S.m.services?.units
          const i = units?.findIndex((x) => x.name === name) ?? -1
          if (i >= 0) units[i] = row
          if (name === 'pidash.service') say('info', 'pidash is restarting. The page reconnects in a few seconds.')
          else if (row.active === 'failed')
            // the next step is in the page, not on the Pi: its logs, a tap away
            say('bad', `${short} restarted but failed.`, {
              action: { label: 'Open its logs', fn: () => logsUI.open(row) },
            })
          else if (row.active === 'activating') say('info', `${short} is still starting. The table shows when it’s up.`)
          else if (row.active === 'active') say('ok', `${short} restarted.`)
          else say('ok', `${short} ran and is ${row.active} again.`)
        } catch (e) {
          if (!(drops && e.status === 0)) throw e
          say(
            'info',
            `${short} is restarting, and the connection dropped with it as expected. The page reconnects by itself.`,
          )
        } finally {
          restarting.delete(name)
          dirty.add('services')
          wake()
        }
      },
      // a refusal names the unit first ("ssh.service: it …"): the toast already does
      (e) =>
        say(
          'bad',
          `Couldn’t restart ${short}: ${e.message.startsWith(`${name}: `) ? e.message.slice(name.length + 2) : e.message}`,
        ),
    )
    return outcome
  }
  SV.r.rows.addEventListener('click', (e) => {
    const b = e.target.closest('.rs, .lg')
    if (!b) return
    if (b.classList.contains('rs')) restartUnit(b.dataset.u)
    else {
      const u = S.m.services?.units?.find((x) => x.name === b.dataset.u)
      if (u) logsUI.open(u)
    }
  })

  function renderServices() {
    const s = S.m.services
    if (!s) return
    if (!s.available) {
      SV.root.toggleAttribute('data-dnp', true)
      SV.r.dnp.hidden = false
      SV.r.dnp.innerHTML = dnp(`Services unavailable: ${s.error}`)
      setText(SV.r.sum, null)
      return
    }
    SV.root.toggleAttribute('data-dnp', false)
    SV.r.dnp.hidden = true
    SV.root.querySelector('.svcs').toggleAttribute('data-norestart', !canChange().configured)
    const q = SV.r.q.value.trim().toLowerCase()
    const match = (u) => !q || u.name.toLowerCase().includes(q) || (u.description || '').toLowerCase().includes(q)
    // "Done" is an active oneshot that ran and exited (API: active "active", sub "exited"). The counts are of what the
    // search leaves, so each filter says how many rows it would show
    const counts = { all: 0, running: 0, done: 0, failed: 0, inactive: 0 }
    for (const u of s.units) {
      if (!match(u)) continue
      counts.all++
      if (u.sub === 'running') counts.running++
      if (u.active === 'active' && u.sub === 'exited') counts.done++
      if (u.active === 'failed') counts.failed++
      if (u.active === 'inactive') counts.inactive++
    }
    for (const [k, n] of Object.entries(counts)) setText(SV.r.filter.querySelector(`[data-n=${k}]`), n)
    let list = s.units.filter((u) => {
      if (svcFilter === 'running' && u.sub !== 'running') return false
      if (svcFilter === 'done' && !(u.active === 'active' && u.sub === 'exited')) return false
      if (svcFilter === 'failed' && u.active !== 'failed') return false
      if (svcFilter === 'inactive' && u.active !== 'inactive') return false
      return match(u)
    })
    // one column, no search: the failed and running units first, then a Show all pad (a search shows every match)
    const short = oneColumn.matches && !q && list.length > SVC_SHORT + 2
    SV.r.more.hidden = !short
    if (short) {
      const rank = (u) => (u.active === 'failed' ? 0 : u.sub === 'running' ? 1 : 2)
      const all = list.length
      if (!svcAll)
        list = list
          .map((u, i) => [u, i])
          .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
          .map(([u]) => u)
          .slice(0, SVC_SHORT)
      setText(SV.r.more, svcAll ? 'Show fewer' : `Show all ${all}`)
      SV.r.more.setAttribute('aria-expanded', String(svcAll))
    }
    setText(
      SV.r.sum,
      `${s.summary.running} running · ${s.summary.active} active · ${s.summary.failed} failed · ${s.summary.total} total`,
    )
    const now = S.m.ts ?? Date.now() / 1000
    syncList(
      SV.r.rows,
      list,
      (u) => u.name,
      () =>
        el(
          `<tr><td>${badgeHTML('st')}</td><td><span class="nm"></span><span class="desc"></span></td><td class="hide-sm" data-k="en"></td><td class="num mem" data-k="mem"></td><td class="num hide-sm" data-k="up"></td><td class="restart"><button type="button" class="lg">${ico(ScrollText)}</button><button type="button" class="rs">${ico(RotateCw)}</button></td></tr>`,
        ),
      (row, u) => {
        const busy = restarting.has(u.name)
        const [tone, label] = busy ? ['warn', 'Restarting'] : svcTone(u)
        badge(row.querySelector('[data-ref=st]'), tone, label)
        const nm = row.querySelector('.nm')
        const html = hl(u.name.replace(/\.service$/, ''), q)
        if (nm._h !== html) nm.innerHTML = nm._h = html
        const desc = row.querySelector('.desc')
        const dh = hl(u.description || '', q)
        if (desc._h !== dh) desc.innerHTML = desc._h = dh
        desc.title = u.description || ''
        setText(row.querySelector('[data-k=en]'), u.enabled)
        setText(row.querySelector('[data-k=mem]'), u.memory_bytes == null ? null : fmt.bytes(u.memory_bytes))
        setText(row.querySelector('[data-k=up]'), u.active_since == null ? null : fmt.dur(now - u.active_since))
        row.toggleAttribute('data-failed', levels.service(u) === 'bad')
        const key = `${u.active}/${u.sub}`
        const prev = svcSeen.get(u.name)
        if (prev && prev !== key) row.dataset.changed = ''
        svcSeen.set(u.name, key)
        const rs = row.querySelector('.rs')
        const lg = row.querySelector('.lg')
        if (rs.dataset.u !== u.name) {
          rs.dataset.u = lg.dataset.u = u.name
          rs.hidden = !canRestart(u.name)
          rs.setAttribute('aria-label', `Restart ${u.name.replace(/\.service$/, '')}`)
          lg.setAttribute('aria-label', `Logs of ${u.name.replace(/\.service$/, '')}`)
        }
        const ltip = auth.signedIn ? 'Logs' : 'Sign in to read the logs'
        if (lg.dataset.tip !== ltip) lg.dataset.tip = ltip
        // aria-disabled, not disabled: the button keeps the keyboard focus while it spins. Written only on a change:
        // this runs for every row on every services tick
        const tip = busy ? 'Restarting…' : auth.signedIn ? 'Restart' : 'Sign in to restart'
        if (rs.dataset.tip !== tip) {
          rs.dataset.tip = tip
          rs.setAttribute('aria-disabled', String(busy))
          rs.toggleAttribute('data-busy', busy)
        }
      },
    )
    SV.r.empty.hidden = list.length > 0
    if (!list.length)
      SV.r.empty.textContent = q
        ? `No service matches “${SV.r.q.value.trim()}”.`
        : svcFilter === 'failed'
          ? 'No failed services.'
          : 'Nothing to show.'
  }
  // a changed row keeps its mark until the user has seen it (hovered or focused)
  SV.r.rows.addEventListener('pointerover', (e) => {
    const tr = e.target.closest('tr[data-changed]')
    if (tr) setTimeout(() => delete tr.dataset.changed, 1200)
  })
  return { renderServices, restartUnit, focusSearch: () => SV.r.q.focus() }
}
