// The README's demo clip (.github/readme/demo.mp4, demo-poster.jpg) from the captures capture.mjs made, following
// docs/images/src/readme/brag-plan.md: four scenes, 1920x1080 at 24 fps, one benefit line per scene, brag's bundled
// music and SFX, the poster baked in as frame 0.
//
//   node docs/images/src/readme/clip.mjs <frames-dir> <out-dir> [--brag <brag skill dir>]
//
// Run from a directory where `npm i --no-save playwright` has been done. Needs ffmpeg. Without --brag (or when the
// skill's assets aren't there) the clip is rendered silent and says so.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, base, capture as cap_, chromium, EXE, esc, expoOut, clamp01, render, window_, winState } from './compose.mjs'

const args = process.argv.slice(2)
const [framesDir, outDir] = args
const BRAG = args.includes('--brag') ? args[args.indexOf('--brag') + 1] : null
if (!framesDir || !outDir) throw new Error('usage: clip.mjs <frames-dir> <out-dir> [--brag <dir>]')
const capture = (n) => cap_(framesDir, n)
const W = 1920, H = 1080, FPS = 24
const WORK = join(outDir, 'work')
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true })

// ------------------------------------------------------------------ the timeline (seconds)
const S1 = 0, S2 = 7.5, S3 = 13.5, S4 = 19.5, END = 22.5, DIP = 0.3
const hero = capture('hero'), fan = capture('fan'), upd = capture('update')
const full = { x: 0, y: 0, w: 1600, h: 900 }
const w1 = window_('s1', 0, 0, W, full), w2 = window_('s2', 0, 0, W, full), w3 = window_('s3', 0, 0, W, full)
const fc = fan.rect('.fanctl')
const zx = (fc.x + fc.width / 2) / 1600, zy = (fc.y + fc.height / 2) / 900 // the push-in centres on the fan card

const line = (id, kicker, text) => `<div id="${id}" class="cap" style="opacity:0"><div class="kick">${esc(kicker)}</div><div class="big">${esc(text)}</div></div>`
const board = 'file://' + join(ROOT, 'docs/images/src/board.png')
const html = base('dark', W, H,
  `<div id="field" style="position:absolute;inset:0;background:#07110d"></div>` + w1.html + w2.html + w3.html +
  `<div id="scrim" class="scrim"></div>` +
  line('c1', 'Health', "Know what's wrong, and where.") + line('c2', 'Fan', 'A quieter or cooler Pi, without a reboot.') + line('c3', 'System', 'Updates, reboots and restarts from your phone, not SSH.') +
  `<div id="outro" style="position:absolute;inset:0;opacity:0">
     <img src="${board}" style="position:absolute;left:1010px;top:60px;height:960px">
     <div id="oname" style="position:absolute;left:120px;top:300px;font-weight:700;font-stretch:116%;font-size:190px;line-height:1;letter-spacing:-.01em;color:#edf0e8">pidash</div>
     <div id="otag" style="position:absolute;left:126px;top:512px;font-size:50px;color:#b3bfb6">Mission control for your Raspberry Pi 5</div>
     <div id="oterm" style="position:absolute;left:126px;top:640px;font-family:M,monospace;font-size:30px;line-height:1.6;color:#edf0e8;white-space:pre"><span style="color:#d9b35d">$ </span><span id="ocmd"></span><span id="ocaret" style="display:inline-block;width:16px;height:32px;background:#d9b35d;vertical-align:-5px"></span>\n<span id="oout" style="color:#b3bfb6"></span></div>
   </div>`,
  `.win img{will-change:transform}
   .scrim{position:absolute;left:0;right:0;bottom:0;height:420px;background:linear-gradient(to top, rgb(7 17 13 / .92), rgb(7 17 13 / .55) 55%, transparent);pointer-events:none}
   .cap{position:absolute;left:96px;bottom:84px;max-width:1500px}
   .kick{font-weight:600;font-stretch:78%;letter-spacing:.09em;text-transform:uppercase;font-size:24px;color:#8a9a90;margin-bottom:14px}
   .big{font-weight:700;font-stretch:116%;letter-spacing:-.01em;font-size:64px;line-height:1.08;color:#edf0e8}
   .cur{width:34px;height:34px}`)
const file = join(WORK, 'clip.html')
writeFileSync(file, html)

/** A caption's opacity and rise at t, for a scene that starts at s0 and ends at s1. */
const capState = (t, s0, s1) => {
  const k = clamp01((t - s0 - 0.5) / 0.6), out = clamp01((s1 - t) / DIP)
  return { style: { opacity: String(expoOut(k) * out), transform: `translateY(${(1 - expoOut(k)) * 28}px)` } }
}
const CMD = 'sudo ./install.sh', TYPE0 = S4 + 0.55, TYPE = 0.065, OUTLINE = 'pidash is running (systemctl status pidash).'

function state(t) {
  const st = { imgs: {}, els: {}, cur: {}, rip: {} }
  const on = (s0, s1) => t >= s0 && t < s1
  const fade = (s0, s1) => clamp01((t - s0) / 0.4) * clamp01((s1 - t) / DIP) // in over 0.4 s, out through the dip
  // scene 1: the hero capture as it was, the pointer turning the board, then resting on the reason
  const a = on(S1, S2) ? winState(w1, hero, Math.min(hero.duration - 0.05, t - S1), { opacity: fade(S1 - 1, S2), cursorScale: 1.4 }) : { imgs: { s1i: { o: 0 } }, cur: { s1c: null }, rip: { s1r: null } }
  // scene 2: the fan capture, a 1.00-1.05 push-in on the fan card
  const z = 1 + 0.05 * clamp01((t - S2) / (S3 - S2))
  const b = on(S2 - 0.05, S3) ? winState(w2, fan, Math.min(fan.duration - 0.05, t - S2 + 0.2), { opacity: fade(S2, S3), zoom: z, zx, zy, cursorScale: 1.4 }) : { imgs: { s2i: { o: 0 } }, cur: { s2c: null }, rip: { s2r: null } }
  // scene 3: the update capture from the open dialog, the log at 1.5x
  const c = on(S3 - 0.05, S4) ? winState(w3, upd, Math.min(upd.duration - 0.05, 2.0 + (t - S3) * 1.5), { opacity: fade(S3, S4), cursorScale: 1.4 }) : { imgs: { s3i: { o: 0 } }, cur: { s3c: null }, rip: { s3r: null } }
  for (const s of [a, b, c]) { Object.assign(st.imgs, s.imgs); Object.assign(st.cur, s.cur); Object.assign(st.rip, s.rip) }
  st.els.c1 = capState(t, S1, S2); st.els.c2 = capState(t, S2, S3); st.els.c3 = capState(t, S3, S4)
  st.els.scrim = { style: { opacity: String(t < S4 ? 1 : 0) } }
  // scene 4: the outro
  const o = clamp01((t - S4) / 0.5)
  const rise = (d) => { const k = expoOut(clamp01((t - S4 - d) / 0.7)); return { style: { opacity: String(k), transform: `translateY(${(1 - k) * 34}px)` } } }
  st.els.outro = { style: { opacity: String(o * clamp01((END - t) / 0.01 + 1)) } }
  st.els.oname = rise(0); st.els.otag = rise(0.12)
  const n = Math.max(0, Math.min(CMD.length, Math.floor((t - TYPE0) / TYPE)))
  st.els.ocmd = { text: CMD.slice(0, n) }
  const typed = t >= TYPE0 + CMD.length * TYPE
  st.els.ocaret = { style: { visibility: t >= S4 + 0.4 && Math.floor(t * 2.5) % 2 === 0 ? 'visible' : 'hidden' } }
  st.els.oout = { text: typed && t >= TYPE0 + CMD.length * TYPE + 0.45 ? OUTLINE : '' }
  st.els.oterm = { style: { opacity: String(expoOut(clamp01((t - S4 - 0.4) / 0.4))) } }
  return st
}

// ------------------------------------------------------------------ render the frames
const b = await chromium.launch({ args: ['--allow-file-access-from-files'], executablePath: EXE })
const fdir = join(WORK, 'frames'); mkdirSync(fdir)
const t0 = Date.now()
const n = await render(b, { file, w: W, h: H, scale: 1, fps: FPS, dur: END, state, dir: fdir, omitBackground: false, type: 'jpeg' })
await b.close()
console.log(`${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`)

// ------------------------------------------------------------------ sound: brag's bundled bed and a few cues
const sfx = (rel) => BRAG && existsSync(join(BRAG, 'assets', rel)) ? join(BRAG, 'assets', rel) : null
const cues = [
  { f: sfx('sfx/interface/drop_001.ogg'), at: S1 + 0.5, v: 0.45 }, { f: sfx('sfx/interface/drop_001.ogg'), at: S2 + 0.5, v: 0.45 }, { f: sfx('sfx/interface/drop_001.ogg'), at: S3 + 0.5, v: 0.45 },
  { f: sfx('sfx/ui/click1.ogg'), at: S2 + 1.4 - 0.2, v: 0.6 }, { f: sfx('sfx/ui/click1.ogg'), at: S3 + (2.7 - 2.0) / 1.5, v: 0.6 },
  { f: sfx('sfx/impact/impactSoft_medium_000.ogg'), at: S4 + 0.05, v: 0.45 },
  ...CMD.split('').map((_, i) => ({ f: sfx(`sfx/keyboard/keypress-${String(1 + ((i * 7) % 32)).padStart(3, '0')}.wav`), at: TYPE0 + i * TYPE, v: 0.28 })),
].filter((c) => c.f)
const music = sfx('music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3')
const inputs = ['-framerate', String(FPS), '-i', join(fdir, 'f%05d.jpeg')]
const fc_ = []
let mixIn = []
if (music) {
  inputs.push('-i', music)
  fc_.push(`[1:a]atrim=0:${END},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.6,afade=t=out:st=${END - 1.6}:d=1.5,volume=0.30[m]`)
  mixIn.push('[m]')
}
cues.forEach((c, i) => {
  inputs.push('-i', c.f)
  const k = (music ? 2 : 1) + i
  fc_.push(`[${k}:a]adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)},volume=${c.v}[x${i}]`)
  mixIn.push(`[x${i}]`)
})
const silent = join(outDir, 'brag.mp4')
const vf = ['-c:v', 'libx264', '-crf', '21', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
if (mixIn.length) {
  fc_.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=first,alimiter=limit=0.9[a]`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', fc_.join(';'), '-map', '0:v', '-map', '[a]', ...vf, '-c:a', 'aac', '-b:a', '128k', '-shortest', silent])
  console.log(`sound: music ${music ? 'vol-12' : 'none'}, ${cues.length} cues`)
} else {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, ...vf, silent])
  console.log('sound: none (brag assets not found); the clip is silent')
}

// ------------------------------------------------------------------ the poster: the settled hook, baked in as frame 0
const POSTER_T = 5.8
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(POSTER_T), '-i', silent, '-frames:v', '1', '-q:v', '2', join(outDir, 'brag.jpg')])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-i', join(outDir, 'brag.jpg'), '-filter_complex', "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]", '-map', '[v]', '-map', '0:a?', ...vf, '-c:a', 'copy', join(outDir, 'brag.poster.mp4')])
execFileSync('mv', [join(outDir, 'brag.poster.mp4'), silent])
writeFileSync(join(outDir, 'share-copy.txt'), 'Introducing pidash: mission control for your Raspberry Pi 5. Live readings pinned to the board, fan curves you draw, updates without SSH, all over your tailnet.\n')
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', silent]).toString().trim()
const kb = Math.round(execFileSync('stat', ['-c', '%s', silent]).toString() / 1024)
console.log(`${silent}: ${dur} s, ${kb} KB; poster at ${POSTER_T} s`)
