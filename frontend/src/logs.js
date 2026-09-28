// Service logs (docs/API.md "GET /api/services/{name}/logs"): a dialog with one unit's journal, opened from its row in
// Services. It only reads, but logs aren't public, so it needs the token like the actions do. While it is open it
// follows new lines every 2 s, only while the page is visible.
import { api } from './net.js'
import { refs, radioGroup, setChecked, setText } from './util.js'

const FOLLOW_MS = 2000
const PAGE = 1000 // the most lines the API returns at once
const KEEP = 2000 // lines kept in the dialog: older ones drop off the top
// The filter's value is the highest syslog priority it shows: 0–3 errors, 4 warnings, 5 notices, 6 info, 7 debug
const LEVELS = [
  ['7', 'All'],
  ['4', 'Warnings'],
  ['3', 'Errors'],
]
const tone = (p) => (p == null || p === 6 ? '' : p <= 3 ? 'err' : p === 4 ? 'warn' : p === 5 ? 'note' : 'dbg')
const shows = (e, level) => (e.priority ?? 6) <= level
const stamp = (ts) => {
  const d = new Date(ts * 1000)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} ${d.toLocaleTimeString(undefined, { hour12: false })}`
}
const span = (cls, text) => {
  const s = document.createElement('span')
  s.className = cls
  s.textContent = text
  return s
}

export function createLogs({ dialog, requireAuth, toast, showDialog }) {
  const R = refs(dialog)
  let unit = null
  let cursor = null
  let entries = []
  let level = 7
  let following = false
  let timer = 0
  let gen = 0 // bumped on every open and close: an answer for an older one is dropped
  let opening = false

  R.level.innerHTML = LEVELS.map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${v === '7'}" tabindex="${v === '7' ? 0 : -1}">${l}<b data-n="${v}"></b></button>`).join('')
  radioGroup(R.level, (v) => {
    level = Number(v)
    setChecked(R.level, v)
    paint()
    R.out.scrollTop = R.out.scrollHeight
  })

  function line(e) {
    const s = span('ln', '')
    const t = tone(e.priority)
    if (t) s.dataset.p = t
    s.append(span('ln-t', stamp(e.ts)), ' ', span('ln-id', `${e.ident ?? '?'}${e.pid ? `[${e.pid}]` : ''}:`), ` ${e.message}\n`)
    return s
  }

  function counts() {
    for (const [v] of LEVELS) setText(R.level.querySelector(`[data-n="${v}"]`), entries.filter((e) => shows(e, Number(v))).length)
    R.out.dataset.empty = !entries.length ? 'Nothing from this service in the journal.' : level === 3 ? 'No errors in these lines.' : 'No warnings or errors in these lines.'
  }

  function paint() {
    const frag = document.createDocumentFragment()
    for (const e of entries) if (shows(e, level)) frag.append(line(e))
    R.out.replaceChildren(frag)
    counts()
  }

  function add(list) {
    if (!list.length) return
    const stick = R.out.scrollHeight - R.out.scrollTop - R.out.clientHeight < 24 // at the bottom: keep following
    entries.push(...list)
    if (entries.length > KEEP) {
      entries.splice(0, entries.length - KEEP)
      paint()
    } else {
      const frag = document.createDocumentFragment()
      for (const e of list) if (shows(e, level)) frag.append(line(e))
      R.out.append(frag)
      counts()
    }
    if (stick) R.out.scrollTop = R.out.scrollHeight
  }

  function note(msg) {
    setText(R.note, msg ?? `${following ? 'Following: new lines show up as they’re logged.' : 'Not following.'} The whole log, on the Pi: journalctl -u ${unit}`)
  }

  function follow(on, why) {
    following = on
    R.follow.setAttribute('aria-checked', String(on))
    note(why)
    clearTimeout(timer)
    if (on) timer = setTimeout(poll, FOLLOW_MS)
  }

  async function poll() {
    clearTimeout(timer)
    if (!dialog.open || !following) return
    if (document.hidden) {
      timer = setTimeout(poll, FOLLOW_MS)
      return
    }
    const g = gen
    const q = new URLSearchParams({ lines: PAGE })
    if (cursor) q.set('after', cursor)
    let r
    try {
      r = await api(`/api/services/${encodeURIComponent(unit)}/logs?${q}`, { timeout: 15000 })
    } catch (e) {
      if (g === gen) follow(false, e.status === 401 ? 'Stopped following: your sign-in has expired. Close this and open the logs again.' : `Stopped following: ${e.message}`)
      return
    }
    if (g !== gen || !following) return
    cursor = r.cursor
    add(r.entries)
    if (r.entries.length === PAGE) return poll() // more are waiting: catch up at once
    note()
    timer = setTimeout(poll, FOLLOW_MS)
  }

  R.follow.addEventListener('click', () => follow(!following))
  dialog.addEventListener('close', () => {
    gen++
    following = false
    clearTimeout(timer)
    entries = []
    R.out.replaceChildren()
  })

  return {
    /** Opens the logs of a services.units[] row. Signs in first when needed. */
    open(u) {
      if (opening || dialog.open) return
      opening = true
      const short = u.name.replace(/\.service$/, '')
      return requireAuth(
        async () => {
          const r = await api(`/api/services/${encodeURIComponent(u.name)}/logs`, { timeout: 15000 })
          gen++
          unit = u.name
          cursor = r.cursor
          entries = r.entries
          R.h.textContent = `${short} logs`
          setText(R.desc, u.description && u.description !== u.name ? `${u.name} · ${u.description}` : u.name)
          paint()
          showDialog(dialog, R.out)
          R.out.scrollTop = R.out.scrollHeight
          follow(true)
        },
        (e) => toast('bad', `Couldn’t read the logs of ${short}: ${e.message}`),
      ).finally(() => (opening = false))
    },
  }
}
