// Preferences: the low-power (2D board) switch kept in local storage, and reduced motion. matchMedia at import, so browser only.
// ------------------------------------------------------------------ preferences

const read = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* storage blocked: the preference lasts for this page only */
  }
}
export const store = { read, write }

const reducedMq = matchMedia('(prefers-reduced-motion: reduce)')
export const prefs = {
  get reduced() {
    return reducedMq.matches
  },
  lowPower: read('pidash.lowpower') === '1',
  setLowPower(on) {
    this.lowPower = on
    write('pidash.lowpower', on ? '1' : null)
  },
  /** Continuous motion (scrolling charts, the 3D sway, spinning blades). Off for reduced motion and in low-power mode. */
  get animate() {
    return !this.reduced && !this.lowPower
  },
}
export const onReducedChange = (fn) => reducedMq.addEventListener('change', fn)
