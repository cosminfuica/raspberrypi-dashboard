// section nav: scroll spy + number keys.
// The lit tab is the section whose top last crossed a line 40 % down the viewport, and it changes only when that
// pick does. Cards side by side in the grid cross together: the first in nav order wins. At the very end of the page
// the last section wins, as the last row may never reach the line.
// A jump (a link to a section, a number key, a part picked on the board) lights its target and holds it until the
// user's next press, key or wheel turn: a smooth jump passes other sections on its way, and where a jump comes to
// rest the line can be on the card beside the target, or below a target in the last row.
// ponytail: any press ends the hold, even one that doesn't scroll; if a later layout shift then moves a section across
// the line, the light follows it. Upgrade: end the hold only on a scroll soon after the user's input.
import { prefs } from '../ui/prefs.js'
import { $ } from '../ui/dom.js'

export function createNav({ focusSearch, focusPads }) {
  const navLinks = [...document.querySelectorAll('.fingers a')]
  const fingers = $('.fingers')
  const navSections = navLinks.map((a) => document.querySelector(a.hash)).filter(Boolean)
  const sectionOf = (hash) => navSections.find((s) => `#${s.id}` === hash)
  let line = innerHeight * 0.4 // px from the top of the viewport, where the spy's root ends
  let atEnd = false // the page's last line is on screen
  let current = null
  let pick = null
  let held = false
  function setCurrent(sec) {
    if (sec === current) return
    current = sec
    for (const a of navLinks) {
      const on = sec != null && a.hash === `#${sec.id}`
      a.setAttribute('aria-current', String(on))
      // on a narrow screen the strip scrolls sideways: keep the current section's tab in view
      if (on && fingers.scrollWidth > fingers.clientWidth)
        fingers.scrollTo({ left: a.offsetLeft - 24, behavior: prefs.reduced ? 'auto' : 'smooth' })
    }
  }
  function follow(force = false) {
    let next = navSections[navSections.length - 1]
    if (!atEnd || scrollY <= 0) {
      const tops = navSections.map((s) => s.getBoundingClientRect().top)
      const top = Math.max(...tops.filter((t) => t <= line))
      next = navSections.find((s, i) => tops[i] <= line && tops[i] >= top - 1) ?? null // null: above the first section
    }
    if (next === pick && !force) return
    pick = next
    if (!held) setCurrent(next)
  }
  function jumped(sec) {
    setCurrent(sec)
    held = true
  }
  // The user's own input ends a hold, in the capture phase: before the click or key that makes the next jump. The page
  // scrolling by itself, as a jump glides or live readings change height, doesn't
  for (const t of ['pointerdown', 'wheel', 'keydown'])
    addEventListener(t, () => (held = false), { capture: true, passive: true })
  // the spy's root is the top 40 % of the viewport: a section enters or leaves it as its top crosses the line
  const spy = new IntersectionObserver(
    (entries) => {
      line = entries[0].rootBounds?.bottom ?? line
      follow()
    },
    { rootMargin: '0px 0px -60% 0px' },
  )
  for (const s of navSections) spy.observe(s)
  new IntersectionObserver((entries) => {
    atEnd = entries[entries.length - 1].isIntersecting
    follow()
  }).observe($('.markings .fine'))
  document.addEventListener('click', (e) => {
    const sec = sectionOf(e.target.closest?.('a[href^="#"]')?.hash)
    if (sec && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) jumped(sec)
  })
  // back and forward restore an older scroll position with no input the page can see
  addEventListener('hashchange', () => {
    const sec = sectionOf(location.hash)
    if (held && sec === current) return // this page's own jump
    held = false
    const r = sec?.getBoundingClientRect()
    if (r && r.top <= line && r.bottom > line)
      jumped(sec) // back where the jump to it came to rest
    else follow(true)
  })
  // opened on a link into a section, the page starts there (a reload restores the old scroll position instead)
  if (performance.getEntriesByType('navigation')[0]?.type === 'navigate' && sectionOf(location.hash))
    jumped(sectionOf(location.hash))
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
    const t = e.target
    if (t.closest?.('input, textarea, select, [contenteditable], .curve')) return
    if (e.key === '/') {
      e.preventDefault()
      focusSearch()
      return
    }
    // F: the fan profile pads, the fastest way to change the fan (arrow keys then move between them)
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      focusPads()
      return
    }
    // the keycaps follow the keyboard's number row: 1–0, then - and =
    const i = '1234567890-='.indexOf(e.key)
    if (i < 0 || !navLinks[i]) return
    const target = document.querySelector(navLinks[i].hash)
    if (!target) return
    e.preventDefault()
    jumped(target)
    target.scrollIntoView({ behavior: prefs.reduced ? 'auto' : 'smooth', block: 'start' })
    const h = target.querySelector('h2')
    if (h) {
      h.tabIndex = -1
      h.focus({ preventScroll: true })
    }
    history.replaceState(null, '', navLinks[i].hash)
  })
  return { jumped, sectionOf }
}
