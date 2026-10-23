// Two-column masonry (style.css .grid): each section spans as many 4px rows as its height needs,
// so a short section never leaves a hole beside a tall one. Below 1100px the grid is a flex column.
import { $ } from '../ui/dom.js'
import { clamp } from '../ui/palette.js'

export function createGrid() {
  const grid = $('.grid')
  const svcWrap = $('#services .table-wrap')
  const moreHint = () =>
    svcWrap.toggleAttribute('data-more', svcWrap.scrollHeight - svcWrap.scrollTop - svcWrap.clientHeight > 4)
  svcWrap.addEventListener('scroll', moreHint, { passive: true })
  const fit = () => {
    const flat = getComputedStyle(grid).display !== 'grid'
    const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--vgap')) || 52
    for (const s of grid.children) {
      const span = flat ? '' : `span ${Math.ceil((s.getBoundingClientRect().height + gap) / 4)}`
      if (s.style.gridRowEnd !== span) s.style.gridRowEnd = span
    }
    // balance the columns: the services list takes the room the right column leaves below the left one
    if (flat) svcWrap.style.maxHeight = ''
    else {
      const bottom = (sel) => Math.max(...[...grid.querySelectorAll(sel)].map((s) => s.offsetTop + s.offsetHeight))
      const cur = parseFloat(svcWrap.style.maxHeight) || 560
      const next = clamp(cur + bottom('.col-r') - bottom('.col-l'), 560, 1600)
      if (Math.abs(next - cur) > 8) svcWrap.style.maxHeight = `${Math.round(next)}px`
    }
    moreHint()
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(fit))
  for (const s of grid.children) ro.observe(s)
  ro.observe(grid)
}
