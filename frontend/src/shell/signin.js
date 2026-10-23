// Sign-in: the token dialog, and requireAuth, which runs a Change signed in and retries it once after a 401.
import { TriangleAlert } from 'lucide'
import { auth, login, isDemo, ApiError } from '../link/net.js'
import { bind, ico, esc } from '../ui/dom.js'
import { S } from './state.js'

/** Whether the fan controls can work at all, and why not. Signing in is asked for only when a change is made. */
export function canChange() {
  if (!S.info) return { configured: false, waiting: true, why: 'Waiting for the Pi…' }
  if (!S.info.auth_configured)
    return {
      configured: false,
      why: 'Changes are off: set PIDASH_TOKEN on the Pi and restart pidash to turn them on. Reading works as usual.',
    }
  return { configured: true, why: '' }
}

export function createSignin() {
  const dlg = bind('login')
  const dlgToken = bind('login-token')
  const dlgErr = bind('login-error')
  const dlgSubmit = bind('login-submit')
  const dlgReveal = bind('login-reveal')
  let pending = null

  /** The token typed on a phone keyboard can be read back before it is sent (#12). */
  function revealToken(on) {
    dlgToken.type = on ? 'text' : 'password'
    dlgReveal.textContent = on ? 'Hide token' : 'Show token'
    dlgReveal.setAttribute('aria-pressed', String(on))
  }
  dlgReveal.addEventListener('click', () => {
    revealToken(dlgToken.type === 'password')
    dlgToken.focus()
  })

  /** Opens a modal dialog and gives focus back to what had it once the dialog closes. */
  function showDialog(d, focus) {
    const back = document.activeElement
    d.addEventListener(
      'close',
      () => back?.isConnected && !document.querySelector('dialog[open]') && back.focus({ preventScroll: true }),
      { once: true },
    )
    d.showModal()
    focus?.focus()
  }

  function openLogin(reason) {
    dlgErr.hidden = true
    dlgToken.value = ''
    revealToken(false)
    if (reason) {
      dlgErr.hidden = false
      dlgErr.innerHTML = `${ico(TriangleAlert)}<span>${esc(reason)}</span>`
    }
    if (isDemo())
      bind('login-why').textContent = 'Demo mode: the token is “demo”. Reading needs no sign-in; changes do.'
    showDialog(dlg, dlgToken)
  }

  bind('login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const token = dlgToken.value.trim()
    if (!token) return
    // hidden again once sent, so a refusal's "Check it with Show token" names the button as it then reads
    revealToken(false)
    dlgSubmit.dataset.busy = ''
    dlgSubmit.disabled = true
    try {
      await login(token)
      dlg.close()
      const p = pending
      pending = null
      p?.resolve()
    } catch (err) {
      dlgErr.hidden = false
      const msg =
        err.status === 401
          ? 'That token isn’t right. Check it with Show token, or ask whoever set up the Pi. On the Pi, sudo grep TOKEN /etc/pidash/pidash.env shows it.'
          : err.status === 403 && err.code === 'auth_not_configured'
            ? 'Changes are turned off on the Pi (no PIDASH_TOKEN set).'
            : err.message
      dlgErr.innerHTML = `${ico(TriangleAlert)}<span>${esc(msg)}</span>`
      dlgToken.select()
    } finally {
      delete dlgSubmit.dataset.busy
      dlgSubmit.disabled = false
    }
  })
  bind('login-cancel').addEventListener('click', () => dlg.close())
  dlg.addEventListener('close', () => {
    if (pending) {
      pending.reject(null)
      pending = null
    }
  })

  /** Runs `fn()` signed in, asking for the token first when needed. A 401 (the session expired, or the token changed on
   *  the Pi) asks again and retries once. */
  async function requireAuth(fn, onError) {
    const signIn = (reason) =>
      new Promise((resolve, reject) => {
        pending = { resolve, reject }
        openLogin(reason)
      })
    try {
      if (!auth.signedIn) await signIn()
    } catch {
      return
    }
    try {
      await fn()
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) return onError?.(err)
      try {
        await signIn('Your sign-in has expired or the token changed. Sign in again to finish.')
        await fn()
      } catch (err2) {
        if (err2) onError?.(err2)
      }
    }
  }
  return { requireAuth, showDialog }
}
