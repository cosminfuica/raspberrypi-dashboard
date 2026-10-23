// The one rAF loop: Sections mark keys dirty and wake() it; frame() runs each key's renderer once.
import { tickTweens, tweenBusy } from '../ui/dom.js'
import { drawCharts, chartsBusy } from '../ui/charts.js'

export const dirty = new Set()
let raf = 0
export function wake() {
  if (!raf) raf = requestAnimationFrame(frame)
}
export const RENDER = {}
function frame(now) {
  raf = 0
  for (const k of dirty) RENDER[k]()
  dirty.clear()
  tickTweens(now)
  drawCharts()
  // a render above may have woken the loop already (a chart's invalidate): queueing a second callback would run
  // frame() twice in the next frame, and the extra callbacks would multiply with every tick
  if (!raf && (tweenBusy() || chartsBusy())) raf = requestAnimationFrame(frame)
}
