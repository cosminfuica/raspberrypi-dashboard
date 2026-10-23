// The Containers Section: the Docker containers with their state, CPU and memory.
import { fmt } from '../ui/format.js'
import { section, dnp, el, setText, esc, badge, badgeHTML, syncList } from '../ui/dom.js'
import { clamp } from '../ui/palette.js'
import { levels } from '../health/verdict.js'
import { S } from '../shell/state.js'

export function createContainers() {
  const DK = section('containers')
  // the tone is the Verdict's level (levels.container), so a badge and its Reason agree; created and exited rate nothing
  const ctrTone = (c) => [
    levels.container(c) ?? 'off',
    c.state === 'running'
      ? c.health === 'unhealthy'
        ? 'Unhealthy'
        : c.health === 'starting'
          ? 'Starting'
          : c.health === 'healthy'
            ? 'Healthy'
            : 'Running'
      : c.state === 'paused'
        ? 'Paused'
        : c.state === 'restarting'
          ? 'Restarting'
          : c.state === 'dead'
            ? 'Dead'
            : c.state === 'created'
              ? 'Created'
              : 'Exited',
  ]
  function renderDocker() {
    const d = S.m.docker
    if (!d) return
    const nav = document.querySelector('.fingers a[href="#containers"]')
    if (!d.available) {
      DK.root.toggleAttribute('data-dnp', true)
      DK.r.list.hidden = true
      DK.r.empty.hidden = true
      DK.r.dnp.hidden = false
      DK.r.dnp.innerHTML = dnp(`Docker can’t be read here (${d.error}). Nothing else is affected.`)
      setText(DK.r.sum, 'Not available')
      nav?.setAttribute('data-dnp', '')
      return
    }
    nav?.removeAttribute('data-dnp')
    DK.root.toggleAttribute('data-dnp', false)
    DK.r.dnp.hidden = true
    DK.r.list.hidden = d.containers.length === 0
    DK.r.empty.hidden = d.containers.length > 0
    if (!d.containers.length)
      DK.r.empty.textContent = `Docker ${d.version} is running with no containers. Anything you start with docker run or compose shows up here.`
    setText(
      DK.r.sum,
      `${d.summary.running} running · ${d.summary.paused} paused · ${d.summary.stopped} stopped · ${d.summary.images} images · Docker ${d.version}`,
    )
    const total = S.info?.memory_total_bytes ?? 1
    syncList(
      DK.r.list,
      d.containers,
      (c) => c.id,
      () =>
        el(`<li class="ctr"><span class="ctr-name"></span><span class="ctr-state">${badgeHTML('st')}</span><span class="ctr-img"></span>
        <span class="ctr-meta"></span><div class="ctr-bars"><div><span data-k="cpu"></span><span class="meter"><i data-b="cpu"></i></span></div><div><span data-k="mem"></span><span class="meter"><i data-b="mem"></i></span></div></div></li>`),
      (li, c) => {
        setText(li.querySelector('.ctr-name'), c.name)
        const [tone, label] = ctrTone(c)
        badge(li.querySelector('[data-ref=st]'), tone, label)
        setText(li.querySelector('.ctr-img'), c.image)
        li.querySelector('.ctr-img').title = c.image
        li.querySelector('.ctr-meta').innerHTML =
          `<span><em>Status</em>${esc(c.status)}</span>${c.ports.length ? `<span><em>Ports</em>${esc(c.ports.join(', '))}</span>` : ''}<span><em>ID</em>${esc(c.id)}</span>`
        const bars = li.querySelector('.ctr-bars')
        bars.hidden = c.cpu_pct == null
        if (c.cpu_pct != null) {
          setText(li.querySelector('[data-k=cpu]'), `CPU ${fmt.pct(c.cpu_pct)}`)
          li.querySelector('[data-b=cpu]').style.setProperty('--f', clamp(c.cpu_pct, 0, 100) / 100)
          setText(
            li.querySelector('[data-k=mem]'),
            `Memory ${fmt.bytes(c.mem_bytes)}${c.mem_limit_bytes && c.mem_limit_bytes < total ? ` of ${fmt.bytes(c.mem_limit_bytes)}` : ''}`,
          )
          li.querySelector('[data-b=mem]').style.setProperty('--f', clamp(c.mem_pct ?? 0, 0, 100) / 100)
        }
      },
    )
  }
  return { renderDocker }
}
