// The Verdict and the Board beside it: paints the Verdict and its Reasons, creates the Board, and lights a Part on the Board, its Callout, its Reasons and its Sections together.
import { ChevronRight } from 'lucide'
import { verdict } from './verdict.js'
import { createStage } from '../board/stage.js'
import { CALLOUTS } from '../board/board.js'
import { prefs } from '../ui/prefs.js'
import { $, bind, setText, esc, ico, badgeHTML } from '../ui/dom.js'
import { rampGradient, T_MIN, T_MAX } from '../ui/palette.js'
import { S, dataAge } from '../shell/state.js'

export function createVerdictView({ sectionOf, jumped, retry, piState, fanStale }) {
  const verdictBox = $('.verdict')
  const checksEl = bind('checks')
  const favicon = bind('favicon')
  let offIcon = '/favicon-off.svg'
  // The rules live in verdict.js (GLOSSARY "Health"); this paints them. No contact comes from the data age, not the link
  // state: a reconnect replays the server's last snapshot, which may be old (plan GAP-2)
  function renderVerdict() {
    const v = verdict({
      m: S.m,
      limits: S.info?.limits ?? {},
      hostname: S.info?.hostname,
      now: Date.now() / 1000 + S.offsetS,
      ageS: dataAge(),
      last: S.last,
      pi: piState(), // 'rebooting' | 'off' | null: the System card knows why the Pi is gone
    })
    if (!v) return
    verdictBox.dataset.tone = v.level
    stage.health(v.parts) // under No contact, none: nothing on the board is known now
    if (v.level === 'off') fanStale() // nor the fan: its LED goes out with the board's
    setText(bind('verdict'), v.headline)
    // the browser tab carries the verdict too: pidash lives in a tab, and the tab strip is where a glance lands
    if (document.title !== v.title) document.title = v.title
    const icon = v.level === 'off' ? offIcon : v.level === 'ok' ? '/favicon.svg' : `/favicon-${v.level}.svg`
    if (favicon.getAttribute('href') !== icon) favicon.setAttribute('href', icon)
    S.last = v.last ?? S.last
    const html = v.rows
      .map((c) =>
        c.retry
          ? `<li><span class="check" data-tone="${c.level}">${badgeHTML('', '')}<span class="check-body"><span class="check-text">${esc(c.text)}</span><span class="check-next">${esc(c.next)}</span></span><button class="textbtn" type="button" data-retry>Retry now</button></span></li>`
          : `<li><a class="check" href="${c.href}" data-tone="${c.level}"${c.part ? ` data-part="${[].concat(c.part)[0]}"` : ''}>${badgeHTML('', '')}<span class="check-body"><span class="check-text">${esc(c.text)}</span>${c.next && c.level !== 'ok' ? `<span class="check-next">${esc(c.next)}</span>` : ''}</span>${ico(ChevronRight, 'check-go')}</a></li>`,
      )
      .join('')
    const list = checksEl
    if (list._html !== html) {
      list._html = html
      list.innerHTML = html
      for (const a of list.querySelectorAll('.check')) {
        a.querySelector('.badge').dataset.tone = a.dataset.tone
        a.toggleAttribute('data-lit', !!hoverPart && a.dataset.part === hoverPart)
      }
    }
  }
  checksEl.addEventListener('click', (e) => e.target.closest('[data-retry]') && retry())

  const stageRoot = bind('stage')
  const lp = bind('lowpower')
  let hoverPart = null
  const partSections = new Map()
  for (const s of document.querySelectorAll('[data-part]')) {
    if (s.tagName !== 'SECTION') continue
    const list = partSections.get(s.dataset.part) || []
    list.push(s)
    partSections.set(s.dataset.part, list)
  }
  function lightPart(part) {
    if (part === hoverPart) return
    hoverPart = part
    stage.light(part)
    for (const [p, list] of partSections) for (const s of list) s.toggleAttribute('data-lit', p === part)
    for (const a of checksEl.querySelectorAll('.check'))
      a.toggleAttribute('data-lit', !!part && a.dataset.part === part)
  }
  const stage = createStage(stageRoot, {
    onHover: lightPart,
    onPick(part) {
      const sec = sectionOf(CALLOUTS.find((c) => c.part === part)?.href)
      if (!sec) return
      jumped(sec)
      sec.scrollIntoView({ behavior: prefs.reduced ? 'auto' : 'smooth', block: 'start' })
    },
    onNoWebGL() {
      // no WebGL here: the 2D drawing stays, and the switch says so
      lp.setAttribute('aria-checked', 'true')
      lp.disabled = true
      lp.title = 'This browser can’t show the 3D view, so the 2D drawing is used'
    },
  })
  // sections light their part on the board while hovered: the net in focus burns brightest
  // A verdict reason lights its part as well (board, callout, section), and a lit part underlines its reasons
  const reasonPart = (e) => lightPart(e.target.closest('.check')?.dataset.part ?? null)
  checksEl.addEventListener('pointerover', reasonPart)
  checksEl.addEventListener('focusin', reasonPart)
  checksEl.addEventListener('pointerleave', () => lightPart(null))
  checksEl.addEventListener('focusout', () => lightPart(null))
  // index.html data-part names each section's part; the fan controls (no id) are not a hover target
  for (const s of document.querySelectorAll('section[id][data-part]')) {
    const part = s.dataset.part
    s.addEventListener('pointerenter', () => lightPart(part))
    s.addEventListener('pointerleave', () => lightPart(null))
  }
  bind('scale-min').textContent = `${T_MIN}\u00a0°C`
  bind('scale-max').textContent = `${T_MAX}\u00a0°C`
  $('.scale-bar').style.background = rampGradient()
  return { renderVerdict, stage, lp, setOffIcon: (u) => (offIcon = u) }
}
