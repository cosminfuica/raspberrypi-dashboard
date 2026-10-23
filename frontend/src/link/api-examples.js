// api-examples.js: node-only test helper. Read by *.test.js and frontend/scripts/*.mjs, never imported by page code
// (it needs node:fs). A port of backend/tests/contract.py example(), so the json examples in backend/tests/API.md
// stay the one source of fixtures.
import { readFileSync } from 'node:fs'

const API_MD = new URL('../../../backend/tests/API.md', import.meta.url)

// The n-th ```json block after `heading` in backend/tests/API.md, parsed.
export function example(heading, n = 0) {
  const text = readFileSync(API_MD, 'utf8')
  const at = text.indexOf(heading)
  if (at < 0) throw new Error(`no such heading in backend/tests/API.md: ${heading}`)
  return JSON.parse([...text.slice(at).matchAll(/```json\n([\s\S]*?)```/g)][n][1])
}
