// The confirm dialog before a destructive Change, and the toasts in the corner.
import { TriangleAlert, X } from 'lucide'
import { bind, el, esc, ico, badgeHTML } from '../ui/dom.js'

export function createFeedback({ requireAuth, showDialog }) {
  const cfm = bind('confirm')
  /** Asks before a destructive action: {title, body, warn?, ok}. Resolves true when confirmed. Cancel has the focus, so
   *  Enter or Escape right away never confirms. */
  function ask({ title, body, warn, ok }) {
    bind('confirm-h').textContent = title
    bind('confirm-body').innerHTML =
      `<p>${esc(body)}</p>${warn ? `<p class="notice notice-warn">${ico(TriangleAlert)}<span>${esc(warn)}</span></p>` : ''}`
    bind('confirm-ok').textContent = ok
    cfm.returnValue = ''
    showDialog(cfm, bind('confirm-cancel'))
    return new Promise((resolve) =>
      cfm.addEventListener('close', () => resolve(cfm.returnValue === 'ok'), { once: true }),
    )
  }

  /** Signs in if needed, asks `q` (a confirm, or null), then runs `fn()`. A retry after signing in again doesn't ask twice. */
  function privileged(q, fn, onError) {
    return requireAuth(async () => {
      if (q && !(await ask(q))) return
      q = null
      await fn()
    }, onError)
  }

  const toasts = bind('toasts')
  /** A message in the corner: tone ok | info | warn | bad. Errors stay until dismissed, the rest go after 6 s (not while
   *  hovered). `action`: {label, fn}, the next step the outcome offers, as a text button under the sentence; using it
   *  closes the toast. Returns {set(msg), close()}. */
  function toast(tone, msg, { sticky = tone === 'bad', busy = false, action = null } = {}) {
    const t = el(`<div class="toast" data-tone="${tone}"${tone === 'bad' ? ' role="alert"' : ''}>${badgeHTML()}<p></p>
      <button class="toast-x" type="button" aria-label="Dismiss">${ico(X)}</button></div>`)
    if (action) {
      const b = el(`<button class="textbtn toast-act" type="button">${esc(action.label)}</button>`)
      b.addEventListener('click', () => {
        close()
        action.fn()
      })
      t.append(b)
    }
    t.querySelector('.badge').dataset.tone = tone
    t.toggleAttribute('data-busy', busy)
    const text = t.querySelector('p')
    text.textContent = msg
    let timer = 0
    const close = () => {
      clearTimeout(timer)
      t.remove()
    }
    const arm = (ms) => {
      clearTimeout(timer)
      if (!sticky) timer = setTimeout(close, ms)
    }
    t.querySelector('.toast-x').addEventListener('click', close)
    t.addEventListener('pointerenter', () => clearTimeout(timer))
    t.addEventListener('pointerleave', () => arm(3000))
    while (toasts.children.length >= 4) toasts.firstElementChild.remove()
    toasts.append(t)
    arm(6000)
    return {
      set: (m) => text.textContent !== m && (text.textContent = m),
      close,
    }
  }
  return { privileged, toast }
}
