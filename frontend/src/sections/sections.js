// sections.js: what each snapshot section redraws, in one table. No imports, so node tests load it.
// Parts stay out on purpose: index.html `data-part` and board.js CALLOUTS own them (sections.test.js checks all three agree).
//   render   the main.js RENDER key (verdict is not here: it runs on every snapshot)
//   from     the GET /api/metrics keys that make it redraw
//   section  the <section id> it paints, null for the page header
//   dim      the `from` keys whose null (a collector crash) dims the section with "No data"
export const RENDERS = [
  { render: 'header', from: ['system', 'cpu'], section: null, dim: [] },
  { render: 'cpu', from: ['cpu'], section: 'cpu', dim: ['cpu'] },
  { render: 'procs', from: ['processes'], section: 'cpu', dim: [] },
  { render: 'thermals', from: ['temps', 'throttling'], section: 'thermals', dim: ['temps'] },
  { render: 'power', from: ['power'], section: 'power', dim: [] },
  { render: 'memory', from: ['memory'], section: 'memory', dim: ['memory'] },
  { render: 'storage', from: ['disks'], section: 'storage', dim: ['disks'] },
  { render: 'network', from: ['network'], section: 'network', dim: ['network'] },
  { render: 'services', from: ['services'], section: 'services', dim: [] },
  { render: 'docker', from: ['docker'], section: 'containers', dim: [] },
  { render: 'tailscale', from: ['tailscale'], section: 'tailnet', dim: [] },
]

// sectionRenders: snapshot key -> the RENDER keys to dirty. dimOnFail: snapshot key -> the section id that dims.
export function derive(rows) {
  // fan is painted by the fan card (fanUI.setFan), not by a RENDER entry
  const sectionRenders = { fan: [] }
  const dimOnFail = {}
  for (const r of rows) {
    for (const k of r.from) (sectionRenders[k] ||= []).push(r.render)
    for (const k of r.dim) dimOnFail[k] = r.section
  }
  return { sectionRenders, dimOnFail }
}
