// The 3D centrepiece: the Pi 5 in its Argon NEO 5 stack, exploded into three layers (blower, board, NVMe base).
// Chips glow with their real temperatures, the blower spins with the tach, copper nets pulse with live traffic.
// Units are millimetres; board.js has the layout. Loaded on demand, so three.js stays out of the main bundle.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh, BoxGeometry, CylinderGeometry, PlaneGeometry,
  RingGeometry, ExtrudeGeometry, Shape, Path, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace,
  DirectionalLight, HemisphereLight, PMREMGenerator, NeutralToneMapping, PCFShadowMap, Color, Vector3, Object3D,
  AdditiveBlending, RepeatWrapping, BufferGeometry, Float32BufferAttribute, EdgesGeometry, LineSegments,
  LineBasicMaterial, Raycaster, Vector2, DoubleSide, CatmullRomCurve3, MathUtils,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BOARD, HOLES, HOLE_R, PARTS, FAN, SSD, LAYERS, NETS } from './board.js'
import { rampRGB, prefs, clamp } from './util.js'

const T = BOARD.t
const SILK = '#e9eee5'
const damp = MathUtils.damp

// ------------------------------------------------------------------ textures

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

function drawPCB(g, W, H) {
  const s = W / BOARD.w
  const P = (x, z) => [(x + BOARD.w / 2) * s, (z + BOARD.d / 2) * s]
  g.fillStyle = '#1f5a3b'
  g.fillRect(0, 0, W, H)

  // copper pours under the mask, around the PMIC and along the power path
  g.fillStyle = '#23653f'
  const pour = (pts) => {
    g.beginPath()
    pts.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](...P(x, z)))
    g.closePath()
    g.fill()
  }
  pour([[-41, 3], [-24, 3], [-20, 7], [-20, 19], [-41, 19]])
  pour([[-24, 17], [-8, 17], [-8, 20.5], [-24, 20.5]])

  // copper traces under the mask: buses routed at 0/45/90°
  g.strokeStyle = '#2b7550'
  g.lineJoin = 'round'
  const bus = (path, n, pitch, w = 0.26) => {
    g.lineWidth = w * s
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * pitch
      g.beginPath()
      offsetPath(path, o).forEach(([x, z], k) => g[k ? 'lineTo' : 'moveTo'](...P(x, z)))
      g.stroke()
    }
  }
  bus([[-14, 12.5], [-14, 16], [-16.7, 18.7], [-16.7, 21.4]], 8, 0.55)
  bus([[-5, 12.5], [-5, 16], [-3.3, 17.7], [-3.3, 21.4]], 8, 0.55)
  bus([[21.3, -4], [24.5, -4], [27.5, -1.1], [29, -1.1]], 6, 0.6)
  bus([[21.3, -11], [23.5, -11], [27.5, -15], [29, -15]], 6, 0.6)
  bus([[20, 6.4], [20, 8.5], [24, 12.5], [25, 12.5]], 6, 0.6)
  bus([[17, -13.3], [17, -16], [11, -22], [11, -23]], 10, 0.9)
  bus([[12.3, -1.3], [12.3, 11.6]], 6, 0.5)
  bus([[10.3, -1.3], [10.3, 3], [6.4, 6.9], [6.4, 11.6]], 6, 0.5)
  bus([[-15, -3.5], [-15, -6.3]], 8, 0.9)
  bus([[-4, -3.5], [-4, -6.3]], 8, 0.9)
  bus([[-1.4, 1], [3, 1], [7, -3], [9.3, -3]], 8, 0.62)
  for (const k of ['wifi', 'pcie']) bus(NETS[k].path, NETS[k].lanes, NETS[k].pitch)
  bus([[-20, -24], [-20, -20], [-17, -17.3]], 5, 0.8)

  // silkscreen
  g.strokeStyle = SILK
  g.fillStyle = SILK
  g.lineWidth = 0.2 * s
  const box = (p, m = 0.7) => {
    const [x0, z0] = P(p.x - p.w / 2 - m, p.z - p.d / 2 - m)
    g.strokeRect(x0, z0, (p.w + 2 * m) * s, (p.d + 2 * m) * s)
    g.beginPath()
    g.arc(x0 - 0.9 * s, z0 + 0.4 * s, 0.35 * s, 0, 7)
    g.fill()
  }
  for (const k of ['soc', 'ram', 'rp1', 'pmic', 'wifi', 'phy', 'eeprom', 'cam0', 'cam1', 'pcie']) box(PARTS[k])
  const text = (str, x, z, size, rot = 0, align = 'center') => {
    g.save()
    g.translate(...P(x, z))
    g.rotate(rot)
    g.font = `700 ${size * s}px Arial, Helvetica, sans-serif`
    g.textAlign = align
    g.textBaseline = 'middle'
    g.fillText(str, 0, 0)
    g.restore()
  }
  text('Raspberry Pi 5', -30.5, -4.2, 2.1)
  text('HDMI0', -16.7, 20.1, 1.1)
  text('HDMI1', -3.3, 20.1, 1.1)
  text('UART', -10.2, 20.9, 1.0)
  text('BAT', -23.8, 20.3, 1.0)
  text('FAN', 24.6, -21.6, 1.1)
  text('PCIe', -36.3, -8.6, 1.1, -Math.PI / 2)
  text('CAM/DISP 1', 4.1, 18.4, 1.0, -Math.PI / 2)
  text('CAM/DISP 0', 14.6, 18.4, 1.0, -Math.PI / 2)
  text('PWR', -38.1, 17.2, 0.9, 0, 'left')
  text('STAT', -38.1, 14.6, 0.9, 0, 'left')
  text('PSW', -38.4, 9, 0.9, 0, 'left')
  text('J1', -25.8, 26.2, 0.9)
  text('J2', -12.2, 26.2, 0.9)
  text('J13', 1.2, 26.2, 0.9)
  text('GPIO', -38.2, -23.6, 1.0, 0, 'left')
  // memory size box, 8G ticked
  text('MEMORY', 2.2, -18.2, 0.95, 0, 'left')
  ;['8G', '4G', '2G', '1G'].forEach((l, i) => {
    const [x, z] = P(2.2 + i * 2.6, -16.4)
    g.strokeRect(x, z, 0.9 * s, 0.9 * s)
    if (i === 0) g.fillRect(x, z, 0.9 * s, 0.9 * s)
    text(l, 3.9 + i * 2.6, -16, 0.8, 0, 'left')
  })

  // ENIG gold: mounting-hole rings and test pads
  g.fillStyle = '#d7b463'
  for (const [x, z] of HOLES) {
    g.beginPath()
    g.arc(...P(x, z), 3.1 * s, 0, 7)
    g.fill()
  }
  for (const [x, z] of [[0.6, 22.4], [2.2, 22.4], [0.6, 24], [2.2, 24], [26.5, -23.6], [-19, 8.6], [-17.6, 8.6]]) {
    g.beginPath()
    g.arc(...P(x, z), 0.55 * s, 0, 7)
    g.fill()
  }
}

function chipTex(lines, { bg = '#141614', ink = 'rgba(232,236,228,0.78)', metal = false } = {}) {
  return canvasTex(256, 256, (g, w, h) => {
    if (metal) {
      const grad = g.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, '#c2c7c9')
      grad.addColorStop(0.5, '#dfe3e4')
      grad.addColorStop(1, '#b5babc')
      g.fillStyle = grad
    } else g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.fillStyle = ink
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    lines.forEach(([str, size], i) => {
      g.font = `700 ${size}px Arial, Helvetica, sans-serif`
      g.fillText(str, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.35)
    })
    g.beginPath()
    g.arc(26, 26, 7, 0, 7)
    g.fill()
  })
}

const glowTex = () =>
  canvasTex(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.28, 'rgba(255,255,255,0.55)')
    r.addColorStop(0.6, 'rgba(255,255,255,0.14)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, w, w)
  })

const pulseTex = () => {
  const t = canvasTex(128, 4, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.72, 'rgba(255,255,255,0.35)')
    grad.addColorStop(0.9, 'rgba(255,255,255,1)')
    grad.addColorStop(0.93, 'rgba(255,255,255,0)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
  })
  t.wrapS = RepeatWrapping
  return t
}

// ------------------------------------------------------------------ geometry helpers

/** Offsets a polyline sideways by d (mitred), in the x/z plane. */
function offsetPath(pts, d) {
  if (!d) return pts
  const n = pts.length
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    const dir = (q, r) => {
      const dx = r[0] - q[0]
      const dz = r[1] - q[1]
      const l = Math.hypot(dx, dz) || 1
      return [dx / l, dz / l]
    }
    const d0 = i > 0 ? dir(a, p) : dir(p, b)
    const d1 = i < n - 1 ? dir(p, b) : d0
    let nx = -(d0[1] + d1[1])
    let nz = d0[0] + d1[0]
    const l = Math.hypot(nx, nz) || 1
    nx /= l
    nz /= l
    const cos = nx * -d1[1] + nz * d1[0]
    const k = d / Math.max(0.5, cos)
    return [p[0] + nx * k, p[1] + nz * k]
  })
}

/** Flat ribbons (one per lane) along a polyline at height y; u runs along the length in `period` mm units. */
function ribbons(path, lanes, pitch, width, y, period = 7) {
  const pos = []
  const uv = []
  const idx = []
  for (let l = 0; l < lanes; l++) {
    const pts = offsetPath(path, (l - (lanes - 1) / 2) * pitch)
    const L = offsetPath(pts, width / 2)
    const R = offsetPath(pts, -width / 2)
    let u = (l * 0.37) % 1 // lanes out of phase
    const base = pos.length / 3
    for (let i = 0; i < pts.length; i++) {
      if (i) u += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / period
      pos.push(L[i][0], y, L[i][1], R[i][0], y, R[i][1])
      uv.push(u, 0, u, 1)
      if (i) {
        const a = base + (i - 1) * 2
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

function roundedRectShape(w, d, r) {
  const s = new Shape()
  const x = -w / 2
  const y = -d / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r)
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

const flat = (geo) => geo.rotateX(-Math.PI / 2) // shape (x, y) → world (x, −z), extruded upward

// ------------------------------------------------------------------ the scene

export async function createScene3D(container, hooks = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1))
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  // nothing that casts a shadow moves once the stack has opened, apart from the spinning rotor (the camera orbits, the
  // light and the parts stay put), so the shadow map is redrawn only during the entrance and while the blades turn
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  renderer.domElement.setAttribute('aria-hidden', 'true')
  container.append(renderer.domElement)

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTex
  scene.environmentIntensity = 0.55
  pmrem.dispose()

  const camera = new PerspectiveCamera(26, 1, 10, 2000)
  const key = new DirectionalLight('#fff4e6', 2.4)
  key.position.set(-70, 170, 110)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  Object.assign(key.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 40, far: 420 })
  key.shadow.bias = -0.0006
  key.shadow.normalBias = 0.35
  scene.add(key, new HemisphereLight('#d8efe2', '#0a1611', 0.7))
  const rim = new DirectionalLight('#b8f0d8', 1.4)
  rim.position.set(90, 60, -140)
  scene.add(rim)

  const disposables = [envTex]
  const keep = (x) => (disposables.push(x), x)
  const std = (o) => keep(new MeshStandardMaterial(o))

  const M = {
    silver: std({ color: '#cfd4d6', metalness: 1, roughness: 0.3 }),
    gold: std({ color: '#e2bd62', metalness: 1, roughness: 0.26 }),
    black: std({ color: '#161817', roughness: 0.55 }),
    plastic: std({ color: '#121413', roughness: 0.7 }),
    hole: std({ color: '#050706', roughness: 1 }),
    white: std({ color: '#e9e3d2', roughness: 0.65 }),
    ffc: std({ color: '#8c6a43', roughness: 0.6 }),
    ffcLid: std({ color: '#3a2d1f', roughness: 0.6 }),
    ind: std({ color: '#50555a', roughness: 0.75, metalness: 0.2 }),
    edge: std({ color: '#7d8759', roughness: 0.85 }),
    usb3: std({ color: '#2f6fe0', roughness: 0.5 }),
    ssd: std({ color: '#111413', roughness: 0.5, metalness: 0.1 }),
    tray: std({ color: '#3b423f', roughness: 0.38, metalness: 0.85 }),
  }
  const pickables = []
  const outlines = {}
  const glows = {}
  const heatMats = {}

  // ---- layer groups
  const fanLayer = new Group()
  const boardLayer = new Group()
  const baseLayer = new Group()
  const stack = new Group()
  stack.add(fanLayer, boardLayer, baseLayer)
  scene.add(stack)

  const add = (parent, geo, mat, x, y, z, { cast = true, receive = false, part } = {}) => {
    const m = new Mesh(keep(geo), mat)
    m.position.set(x, y, z)
    m.castShadow = cast
    m.receiveShadow = receive
    if (part) {
      m.userData.part = part
      pickables.push(m)
    }
    parent.add(m)
    return m
  }

  // courtyard outline that lights up gold when its part is in focus
  const courtyard = (parent, part, w, d, y, x, z) => {
    const geo = keep(new EdgesGeometry(new BoxGeometry(w, 0.01, d)))
    const mat = keep(new LineBasicMaterial({ color: '#f0cf7e', transparent: true, opacity: 0 }))
    const l = new LineSegments(geo, mat)
    l.position.set(x, y, z)
    parent.add(l)
    outlines[part] = mat
  }

  // heat glow: an additive disc above a part, coloured and scaled by its temperature
  const gTex = keep(glowTex())
  const glow = (parent, part, size, x, y, z) => {
    const mat = keep(new MeshBasicMaterial({ map: gTex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }))
    const m = new Mesh(keep(new PlaneGeometry(size, size)), mat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, y, z)
    m.renderOrder = 2
    parent.add(m)
    glows[part] = { mat, mesh: m, size }
  }

  // ================================================================ board layer
  {
    const shape = roundedRectShape(BOARD.w, BOARD.d, 3)
    for (const [x, z] of HOLES) {
      const h = new Path()
      h.absarc(x, -z, HOLE_R, 0, Math.PI * 2, true)
      shape.holes.push(h)
    }
    const geo = flat(new ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 20 }))
    const pcbTex = keep(canvasTex(2048, Math.round((2048 * BOARD.d) / BOARD.w), drawPCB))
    pcbTex.repeat.set(1 / BOARD.w, 1 / BOARD.d)
    pcbTex.offset.set(0.5, 0.5)
    const pcb = std({ map: pcbTex, roughness: 0.52, metalness: 0.05 })
    add(boardLayer, geo, [pcb, M.edge], 0, 0, 0, { receive: true })
  }
  const P = PARTS
  const top = (p) => T + p.h / 2
  const chipMat = (part, tex, extra = {}) => {
    const side = std({ color: '#171917', roughness: 0.55, ...extra })
    const face = std({ map: tex, roughness: extra.metalness ? 0.34 : 0.55, ...extra })
    heatMats[part] = [side, face]
    return [side, side, face, side, side, side]
  }

  // SoC: substrate plus nickel lid
  add(boardLayer, new BoxGeometry(P.soc.w, 0.7, P.soc.d), std({ color: '#243128', roughness: 0.6 }), P.soc.x, T + 0.35, P.soc.z)
  add(
    boardLayer,
    new BoxGeometry(13.6, 1.2, 13.6),
    chipMat('soc', keep(chipTex([['BROADCOM', 30], ['BCM2712', 30], ['ZPKFSB00C1T', 20]], { metal: true, ink: 'rgba(70,74,76,0.55)' })), { color: '#ffffff', metalness: 0.95 }),
    P.soc.x, T + 1.3, P.soc.z, { part: 'soc' },
  )
  courtyard(boardLayer, 'soc', P.soc.w + 2, P.soc.d + 2, T + 0.02, P.soc.x, P.soc.z)
  // heat halos lie on the board surface: parts occlude their centre, so each reads as a warm aura around its chip
  glow(boardLayer, 'soc', 58, P.soc.x, T + 0.06, P.soc.z)

  add(boardLayer, new BoxGeometry(P.ram.w, P.ram.h, P.ram.d), chipMat('ram', keep(chipTex([['SEC 334', 30], ['LPDDR4X', 36]]))), P.ram.x, top(P.ram), P.ram.z, { part: 'ram' })
  courtyard(boardLayer, 'ram', P.ram.w + 2, P.ram.d + 2, T + 0.02, P.ram.x, P.ram.z)
  add(boardLayer, new BoxGeometry(P.rp1.w, P.rp1.h, P.rp1.d), chipMat('rp1', keep(chipTex([['RP1-C0', 40], ['23/29', 26]]))), P.rp1.x, top(P.rp1), P.rp1.z, { part: 'rp1' })
  courtyard(boardLayer, 'rp1', P.rp1.w + 2, P.rp1.d + 2, T + 0.02, P.rp1.x, P.rp1.z)
  glow(boardLayer, 'rp1', 36, P.rp1.x, T + 0.06, P.rp1.z)
  add(boardLayer, new BoxGeometry(P.pmic.w, P.pmic.h, P.pmic.d), chipMat('pmic', keep(chipTex([['DA9091', 44]]))), P.pmic.x, top(P.pmic), P.pmic.z, { part: 'pmic' })
  courtyard(boardLayer, 'pmic', P.pmic.w + 2, P.pmic.d + 2, T + 0.02, P.pmic.x, P.pmic.z)
  glow(boardLayer, 'pmic', 24, P.pmic.x, T + 0.06, P.pmic.z)
  for (let i = 0; i < 4; i++) add(boardLayer, new BoxGeometry(2.6, 1.3, 2.6), M.ind, -35.5 + i * 3.3, T + 0.65, 5.6)
  add(boardLayer, new BoxGeometry(P.wifi.w, P.wifi.h, P.wifi.d), M.silver, P.wifi.x, top(P.wifi), P.wifi.z, { part: 'wifi' })
  courtyard(boardLayer, 'wifi', P.wifi.w + 2, P.wifi.d + 2, T + 0.02, P.wifi.x, P.wifi.z)
  add(boardLayer, new BoxGeometry(P.phy.w, P.phy.h, P.phy.d), M.black, P.phy.x, top(P.phy), P.phy.z).rotation.y = Math.PI / 4
  add(boardLayer, new BoxGeometry(P.eeprom.w, P.eeprom.h, P.eeprom.d), M.black, P.eeprom.x, top(P.eeprom), P.eeprom.z)

  // GPIO header and every gold pin (header, PoE, fan) in one instanced mesh
  add(boardLayer, new BoxGeometry(P.gpio.w, P.gpio.h, P.gpio.d), M.plastic, P.gpio.x, top(P.gpio), P.gpio.z)
  add(boardLayer, new BoxGeometry(P.poe.w, P.poe.h, P.poe.d), M.plastic, P.poe.x, top(P.poe), P.poe.z)
  {
    const pins = []
    for (let i = 0; i < 20; i++) for (const dz of [-1.27, 1.27]) pins.push([P.gpio.x - 24.13 + i * 2.54, P.gpio.z + dz, 8.5])
    for (const dx of [-1.27, 1.27]) for (const dz of [-1.27, 1.27]) pins.push([P.poe.x + dx, P.poe.z + dz, 7.5])
    const im = new InstancedMesh(keep(new BoxGeometry(0.64, 1, 0.64)), M.gold, pins.length)
    const o = new Object3D()
    pins.forEach(([x, z, h], i) => {
      o.position.set(x, T + h / 2, z)
      o.scale.set(1, h, 1)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    })
    im.castShadow = true
    boardLayer.add(im)
  }

  // passives scattered around the big chips (deterministic)
  {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const spots = []
    const ring = (cx, cz, hw, hd, n, gap) => {
      for (let i = 0; i < n; i++) {
        const side = i % 4
        const t = rnd() * 2 - 1
        const off = gap + rnd() * 1.6
        spots.push(side === 0 ? [cx + t * hw, cz - hd - off, 0] : side === 1 ? [cx + t * hw, cz + hd + off, 0] : side === 2 ? [cx - hw - off, cz + t * hd, 1] : [cx + hw + off, cz + t * hd, 1])
      }
    }
    ring(P.soc.x, P.soc.z, 7.5, 7.5, 44, 1.2)
    ring(P.rp1.x, P.rp1.z, 5.5, 5.5, 28, 1.0)
    ring(P.pmic.x, P.pmic.z, 3, 3, 16, 1.0)
    ring(P.ram.x, P.ram.z, 7, 5, 18, 0.9)
    const im = new InstancedMesh(keep(new BoxGeometry(1.0, 0.5, 0.5)), std({ color: '#8c7a5c', roughness: 0.6 }), spots.length)
    const o = new Object3D()
    spots.forEach(([x, z, r], i) => {
      o.position.set(x, T + 0.25, z)
      o.rotation.set(0, r ? Math.PI / 2 : 0, 0)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    })
    boardLayer.add(im)
  }

  // ports along the edges
  const decal = (parent, w, h, d, x, y, z, mat = M.hole) => add(parent, new BoxGeometry(w, h, d), mat, x, y, z, { cast: false })
  for (const [p, tongue] of [[P.usb2, M.plastic], [P.usb3, M.usb3]]) {
    add(boardLayer, new RoundedBoxGeometry(p.w, p.h, p.d, 2, 0.6), M.silver, p.x, top(p), p.z)
    for (const y of [T + 4.3, T + 11.7]) {
      decal(boardLayer, 0.3, 5.6, 12.4, p.x + p.w / 2 + 0.05, y, p.z)
      decal(boardLayer, 0.3, 1.4, 10, p.x + p.w / 2 + 0.12, y + 0.9, p.z, tongue)
    }
  }
  add(boardLayer, new RoundedBoxGeometry(P.eth.w, P.eth.h, P.eth.d, 2, 0.6), M.silver, P.eth.x, top(P.eth), P.eth.z)
  decal(boardLayer, 0.3, 8.6, 11.6, P.eth.x + P.eth.w / 2 + 0.05, T + 5.2, P.eth.z)
  const ethLed = [0, 1].map((i) => {
    const mat = std({ color: '#202422', emissive: new Color(i ? '#ffb030' : '#40e070'), emissiveIntensity: 0, roughness: 0.4 })
    decal(boardLayer, 0.3, 1.3, 2.4, P.eth.x + P.eth.w / 2 + 0.12, T + 11.4, P.eth.z + (i ? -5.6 : 5.6), mat)
    return mat
  })
  for (const p of [P.hdmi0, P.hdmi1]) {
    add(boardLayer, new RoundedBoxGeometry(p.w, p.h, p.d, 2, 0.5), M.silver, p.x, top(p), p.z)
    decal(boardLayer, 6.2, 1.6, 0.3, p.x, top(p), p.z + p.d / 2 + 0.05)
  }
  add(boardLayer, new RoundedBoxGeometry(P.usbc.w, P.usbc.h, P.usbc.d, 3, 1.4), M.silver, P.usbc.x, top(P.usbc), P.usbc.z)
  decal(boardLayer, 7.4, 1.6, 0.3, P.usbc.x, top(P.usbc), P.usbc.z + P.usbc.d / 2 + 0.05)
  for (const p of [P.cam0, P.cam1, P.pcie]) {
    add(boardLayer, new BoxGeometry(p.w, p.h, p.d), M.ffc, p.x, top(p), p.z)
    add(boardLayer, new BoxGeometry(p.w * 0.45, 0.3, p.d * 0.94), M.ffcLid, p.x + (p === P.pcie ? -0.8 : 0.8), T + p.h + 0.15, p.z, { cast: false })
  }
  for (const p of [P.fanHdr, P.uart, P.bat]) add(boardLayer, new BoxGeometry(p.w, p.h, p.d), M.white, p.x, top(p), p.z)
  add(boardLayer, new BoxGeometry(P.button.w, P.button.h, P.button.d), M.plastic, P.button.x, top(P.button), P.button.z)
  const actLed = std({ color: '#1d2a20', emissive: new Color('#46ff8a'), emissiveIntensity: 0, roughness: 0.4 })
  add(boardLayer, new BoxGeometry(1.6, 0.6, 1), actLed, -40, T + 0.3, 14.6, { cast: false })
  add(boardLayer, new BoxGeometry(1.6, 0.6, 1), std({ color: '#3a1512', roughness: 0.4 }), -40, T + 0.3, 17.2, { cast: false })

  // live copper nets
  const nets = {}
  const memBus = () => {
    // ten short hops between the SoC and the RAM, spread across x
    const pos = []
    const uv = []
    const idx = []
    for (let i = 0; i < 10; i++) {
      const x = P.soc.x - 5.6 + i * 1.25
      const b = pos.length / 3
      pos.push(x - 0.22, T + 0.03, -3.3, x + 0.22, T + 0.03, -3.3, x - 0.22, T + 0.03, -6.5, x + 0.22, T + 0.03, -6.5)
      const u = (i * 0.29) % 1
      uv.push(u, 0, u, 1, u + 0.5, 0, u + 0.5, 1)
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    return geo
  }
  for (const k of ['mem', 'wifi', 'pcie']) {
    const geo = k === 'mem' ? memBus() : ribbons(NETS[k].path, NETS[k].lanes, NETS[k].pitch, 0.42, T + 0.03)
    const tex = keep(pulseTex())
    const mat = keep(new MeshBasicMaterial({ map: tex, color: '#ffc27a', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }))
    const mesh = new Mesh(keep(geo), mat)
    mesh.renderOrder = 3
    boardLayer.add(mesh)
    nets[k] = { tex, mat, level: 0, speed: 0 }
  }

  // ================================================================ fan layer (Argon NEO 5 blower)
  const fan = {}
  {
    const housing = roundedRectShape(33, 33, 4)
    const hole = new Path()
    hole.absarc(0, 0, 14.6, 0, Math.PI * 2, true)
    housing.holes.push(hole)
    const hGeo = flat(new ExtrudeGeometry(housing, { depth: 5.5, bevelEnabled: false, curveSegments: 40 }))
    add(fanLayer, hGeo, std({ color: '#3a403d', roughness: 0.38, metalness: 0.55 }), FAN.x, 0, FAN.z, { part: 'fan' })
    add(fanLayer, new CylinderGeometry(15.4, 15.4, 0.6, 48), std({ color: '#0e110f', roughness: 0.8 }), FAN.x, 0.3, FAN.z, { cast: false, receive: true })
    const rotor = new Group()
    rotor.position.set(FAN.x, 0.6, FAN.z)
    fanLayer.add(rotor)
    const hubTex = keep(
      canvasTex(256, 256, (g, w) => {
        g.fillStyle = '#1b1f1d'
        g.fillRect(0, 0, w, w)
        g.strokeStyle = '#d9b35d'
        g.lineWidth = 7
        g.beginPath()
        g.arc(w / 2, w / 2, w * 0.36, 0, 7)
        g.stroke()
        g.fillStyle = 'rgba(233,238,229,0.7)'
        g.font = '700 30px Arial, sans-serif'
        g.textAlign = 'center'
        // CylinderGeometry's top cap maps u mirrored, so the label is drawn mirrored to read right way round
        g.translate(w, 0)
        g.scale(-1, 1)
        g.fillText('5V · 0.18A', w / 2, w / 2 + 11)
      }),
    )
    const hubSide = std({ color: '#202523', roughness: 0.5 })
    const hub = new Mesh(keep(new CylinderGeometry(FAN.hub, FAN.hub, 4.4, 48)), [hubSide, std({ map: hubTex, roughness: 0.5 }), hubSide])
    hub.position.y = 2.2
    hub.castShadow = true
    rotor.add(hub)
    const N = 23
    const blades = new InstancedMesh(keep(new BoxGeometry(0.45, 4.2, 6.2)), std({ color: '#565e5a', roughness: 0.45 }), N)
    const o = new Object3D()
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      o.position.set(Math.cos(a) * 10.6, 2.1, Math.sin(a) * 10.6)
      o.rotation.set(0, -a + 0.55, 0)
      o.updateMatrix()
      blades.setMatrixAt(i, o.matrix)
    }
    blades.castShadow = true
    rotor.add(blades)
    const blurMat = keep(new MeshBasicMaterial({ color: '#232a27', transparent: true, opacity: 0, depthWrite: false }))
    const blur = new Mesh(keep(new RingGeometry(FAN.hub + 0.2, 14.2, 64)), blurMat)
    blur.rotation.x = -Math.PI / 2
    blur.position.set(FAN.x, 4.35, FAN.z)
    fanLayer.add(blur)
    courtyard(fanLayer, 'fan', 35, 35, 5.6, FAN.x, FAN.z)
    Object.assign(fan, { rotor, blurMat, angle: 0 })

    // ghost of the case lid, so the layer reads as the NEO 5 without hiding the board
    const lid = roundedRectShape(94, 64, 6)
    const lidHole = new Path()
    lidHole.absarc(FAN.x, -FAN.z, 17, 0, Math.PI * 2, true)
    lid.holes.push(lidHole)
    const lidGeo = keep(new EdgesGeometry(flat(new ExtrudeGeometry(lid, { depth: 2.2, bevelEnabled: false, curveSegments: 28 })), 30))
    const ghost = keep(new LineBasicMaterial({ color: SILK, transparent: true, opacity: 0.16 }))
    const l = new LineSegments(lidGeo, ghost)
    l.position.set(0, 1.6, 0)
    fanLayer.add(l)
  }

  // ================================================================ base layer (M.2 SSD in the NEO 5 base)
  let ribbon
  {
    const trayShape = roundedRectShape(94, 64, 6)
    const trayGeo = keep(new EdgesGeometry(flat(new ExtrudeGeometry(trayShape, { depth: 6, bevelEnabled: false, curveSegments: 28 })), 30))
    const ghost = keep(new LineBasicMaterial({ color: SILK, transparent: true, opacity: 0.16 }))
    const l = new LineSegments(trayGeo, ghost)
    l.position.y = -6
    baseLayer.add(l)
    add(baseLayer, new BoxGeometry(88, 0.8, 58), M.tray, 0, -6.4, 0, { receive: true, cast: false })
    // the M.2 adapter board and the 2280 drive
    add(baseLayer, new BoxGeometry(84, 1, 30), std({ color: '#0f1311', roughness: 0.55 }), 0, -5.5, SSD.z, { receive: true })
    add(baseLayer, new BoxGeometry(SSD.w, 0.8, SSD.d), M.ssd, SSD.x, -4.6, SSD.z, { receive: true })
    const label = keep(
      canvasTex(1024, 282, (g, w, h) => {
        g.fillStyle = '#16191a'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#3c6fd8'
        g.fillRect(0, 0, 18, h)
        g.fillStyle = 'rgba(233,238,229,0.85)'
        g.font = '700 58px Arial, sans-serif'
        g.fillText('SN580', 70, 118)
        g.font = '600 34px Arial, sans-serif'
        g.fillStyle = 'rgba(233,238,229,0.6)'
        g.fillText('NVMe SSD · 1 TB · PCIe', 70, 180)
      }),
    )
    const labelMat = std({ map: label, roughness: 0.6 })
    const sticker = add(baseLayer, new BoxGeometry(46, 0.15, 19), labelMat, SSD.x + 12, -4.12, SSD.z, { cast: false, part: 'ssd' })
    sticker.receiveShadow = true
    add(baseLayer, new BoxGeometry(SSD.ctrl.w, 1, SSD.ctrl.d), chipMat('ssd', keep(chipTex([['NVMe', 40]]))), SSD.x + SSD.ctrl.x, -3.7, SSD.z + SSD.ctrl.z, { part: 'ssd' })
    add(baseLayer, new BoxGeometry(3.2, 0.2, 19), M.gold, SSD.x - SSD.w / 2 + 1.8, -4.1, SSD.z, { cast: false })
    add(baseLayer, new CylinderGeometry(2.2, 2.2, 1.6, 20), M.gold, SSD.x + SSD.w / 2 - 2.5, -4.6, SSD.z, { cast: false })
    courtyard(baseLayer, 'ssd', SSD.w + 2, SSD.d + 2, -4.1, SSD.x, SSD.z)
    glow(baseLayer, 'ssd', 36, SSD.x + SSD.ctrl.x, -4.14, SSD.z + SSD.ctrl.z)
    add(baseLayer, new BoxGeometry(3.4, 1.3, 12.5), M.ffc, -40, -4.4, P.pcie.z)
    // the PCIe FFC ribbon between the board and the base, rebuilt while the layers move
    const rMat = std({ color: '#b98a45', roughness: 0.55, metalness: 0.1, side: DoubleSide, transparent: true, opacity: 0.92 })
    const pTex = keep(pulseTex())
    pTex.repeat.set(3, 1)
    const pMat = keep(new MeshBasicMaterial({ map: pTex, color: '#ffc27a', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }))
    const body = new Mesh(new BufferGeometry(), rMat)
    const glowStrip = new Mesh(new BufferGeometry(), pMat)
    body.castShadow = true
    glowStrip.renderOrder = 3
    scene.add(body, glowStrip)
    ribbon = { body, glowStrip, tex: pTex, mat: pMat, level: 0, speed: 0, gap: null }
  }

  function buildRibbon(boardY, baseY) {
    const a = new Vector3(P.pcie.x - 1.2, boardY + T + 1, P.pcie.z)
    const b = new Vector3(-40.8, baseY - 3.8, P.pcie.z)
    const mid = (a.y + b.y) / 2
    const curve = new CatmullRomCurve3([
      a,
      new Vector3(a.x - 5, a.y + 1, a.z),
      new Vector3(-52, mid + (a.y - mid) * 0.35, a.z),
      new Vector3(-52, mid - (a.y - mid) * 0.35, a.z),
      new Vector3(b.x - 6, b.y + 1, b.z),
      b,
    ])
    const pts = curve.getPoints(48)
    const mk = (half, lift) => {
      const pos = []
      const uv = []
      const idx = []
      let u = 0
      pts.forEach((p, i) => {
        if (i) u += p.distanceTo(pts[i - 1]) / 20
        pos.push(p.x - lift, p.y, p.z - half, p.x - lift, p.y, p.z + half)
        uv.push(u, 0, u, 1)
        if (i) {
          const k = (i - 1) * 2
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
        }
      })
      const geo = new BufferGeometry()
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
      geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      return geo
    }
    ribbon.body.geometry.dispose()
    ribbon.glowStrip.geometry.dispose()
    ribbon.body.geometry = mk(5.8, 0)
    ribbon.glowStrip.geometry = mk(4.6, 0.12)
  }

  // ================================================================ state, camera, interaction

  const v = { soc: null, rp1: null, pmic: null, nvme: null, rpm: 0, cpu: 0, wifi: 0, disk: 0, eth: false, ethAct: 0 }
  const shown = { soc: 0.3, rp1: 0.3, pmic: 0.3, ssd: 0.3, rpm: 0 }
  const view = { az: 0.5, el: 0.52, dist: 285, targetAz: 0.5, targetEl: 0.52, vAz: 0, lastUser: -1e9 }
  let explode = prefs.reduced ? 1 : 0
  let explodeT0 = null
  let lit = null
  let size = { w: 1, h: 1 }
  let running = false
  let raf = 0
  let visible = false
  let last = performance.now()
  let dirty = true

  const heatOf = (c) => (c == null ? 0 : clamp((c - 30) / 60, 0, 1))
  const tmpColor = new Color()

  function applyHeat() {
    const set = (part, h) => {
      const [r, g, b] = rampRGB(h)
      tmpColor.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
      // glow rises fast through the everyday 40-65 °C band (h ≈ 0.15-0.6), so a warm part visibly warms up
      const k = clamp((h - 0.1) / 0.7, 0, 1) ** 0.75
      const w = glows[part]
      if (w) {
        // a halo on the board around the part, in the legend's colour for its temperature
        w.mat.color.copy(tmpColor).multiplyScalar(1.5)
        w.mat.opacity = Math.min(1, 1.15 * k)
        const s = 0.8 + 0.45 * k
        w.mesh.scale.set(s, s, s)
      }
      for (const m of heatMats[part] || []) {
        m.emissive.copy(tmpColor)
        const hover = lit === part
        if (m.metalness > 0.5) {
          // a metal lid mirrors the room, so heat tints the metal; a hot lid also glows, or the white-hot end of the
          // ramp would only lighten the silver and the hottest part on the board would read as the coolest
          m.color.setRGB(1, 1, 1).lerp(tmpColor, 0.7 * k)
          m.emissiveIntensity = Math.max(hover ? 0.35 : 0, 0.9 * k * k)
        } else m.emissiveIntensity = Math.max(hover ? 0.9 : 0, 0.15 + 1.05 * k)
      }
    }
    set('soc', shown.soc)
    set('rp1', shown.rp1)
    set('pmic', shown.pmic)
    set('ssd', shown.ssd)
  }

  function place(p) {
    const e = MathUtils.smootherstep(p, 0, 1)
    fanLayer.position.y = 6 + (LAYERS.fan - 6) * e
    baseLayer.position.y = -4 + (LAYERS.base + 4) * e
    const gap = Math.round(e * 200)
    if (gap !== ribbon.gap) {
      ribbon.gap = gap
      buildRibbon(0, baseLayer.position.y)
    }
  }

  function aimCamera() {
    const { az, el, dist } = view
    const aspect = size.w / size.h
    // the stack is about 103 mm across, so at distance d it spans 223·H/d px (fov 26°): back off until it fits
    // between the callout columns (230 leaves a margin), so no box ever sits on the model
    const room = Math.max(size.w * 0.4, size.w - 2 * (hooks.inset?.() ?? 0))
    const d = Math.max(dist / Math.min(1, aspect / 1.35), (230 * size.h) / room)
    camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d + 2, Math.cos(az) * Math.cos(el) * d)
    camera.lookAt(0, 1, 0)
    // the exploded stack is taller than it is wide on screen: nudge it up and a touch left, clear of the callout columns
    camera.setViewOffset(size.w, size.h, size.w * 0.012, size.h * 0.045, size.w, size.h)
  }

  function resize() {
    const r = container.getBoundingClientRect()
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) }
    renderer.setSize(size.w, size.h, false)
    camera.aspect = size.w / size.h
    camera.updateProjectionMatrix()
    dirty = true
    kick()
  }

  function frame(now) {
    raf = 0
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const anim = prefs.animate
    if (explode < 1) {
      // wall-clock based, so a slow first few frames don't stretch the entrance
      explodeT0 ??= now
      explode = anim ? Math.min(1, (now - explodeT0) / 1800) : 1
      // the layers move: their shadows move with them (the shadow map is otherwise drawn once, it never changes)
      renderer.shadowMap.needsUpdate = true
      dirty = true
    }
    place(explode)

    // camera: user drag with inertia, then a slow sway when idle
    if (Math.abs(view.vAz) > 1e-4) {
      view.targetAz += view.vAz
      view.vAz *= 0.92
      dirty = true
    }
    const idle = now - view.lastUser > 6000
    const sway = anim && idle ? 0.16 * Math.sin(now / 9000) : 0
    const az = view.targetAz + sway
    if (Math.abs(az - view.az) > 1e-4 || Math.abs(view.targetEl - view.el) > 1e-4) {
      view.az = damp(view.az, az, 6, dt)
      view.el = damp(view.el, view.targetEl, 6, dt)
      dirty = true
    }
    if (anim && idle) dirty = true
    aimCamera()

    // readings ease toward their targets
    const ease = (k, target, rate = 2.5) => {
      if (target == null) return
      const nv = damp(shown[k], target, rate, anim ? dt : 1)
      if (Math.abs(nv - shown[k]) > 1e-4) dirty = true
      shown[k] = nv
    }
    ease('soc', heatOf(v.soc))
    ease('rp1', heatOf(v.rp1))
    ease('pmic', heatOf(v.pmic))
    ease('ssd', heatOf(v.nvme))
    ease('rpm', v.rpm, 3)
    applyHeat()

    // blower: angular speed follows the measured rpm, scaled to stay below the display's strobe limit
    const rps = 1.2 * (1 - Math.exp(-shown.rpm / 3600))
    fan.blurMat.opacity = 0.62 * (1 - Math.exp(-shown.rpm / 4200))
    if (anim && shown.rpm > 1) {
      fan.angle -= rps * Math.PI * 2 * dt
      fan.rotor.rotation.y = fan.angle
      renderer.shadowMap.needsUpdate = true // the blades' shadow on the board turns with them
      dirty = true
    }

    // copper nets: brightness and pulse speed follow live traffic
    const flow = (n, level, dtk) => {
      n.level = damp(n.level, level, 3, anim ? dt : 1)
      n.mat.opacity = n.level * 0.95
      if (anim && n.level > 0.01) {
        n.tex.offset.x -= (0.35 + 1.6 * n.level) * dtk
        dirty = true
      }
    }
    flow(nets.mem, clamp(v.cpu / 100, 0, 1) ** 0.7, dt)
    flow(nets.wifi, clamp(Math.log10(1 + v.wifi / 2000) / 3.3, 0, 1), dt)
    flow(nets.pcie, clamp(Math.log10(1 + v.disk / 4000) / 3.6, 0, 1), dt)
    flow(ribbon, clamp(Math.log10(1 + v.disk / 4000) / 3.6, 0, 1), dt)
    actLed.emissiveIntensity = v.disk > 0 && (!anim || Math.sin(now / 45) > 0.2) ? 2.4 * Math.min(1, 0.25 + v.disk / 3e5) : 0
    if (anim && v.disk > 0) dirty = true
    ethLed[0].emissiveIntensity = v.eth ? 2 : 0
    ethLed[1].emissiveIntensity = v.eth && v.ethAct > 0 && (!anim || Math.sin(now / 60) > 0) ? 2 : 0

    for (const [part, mat] of Object.entries(outlines)) {
      const to = lit === part ? 1 : 0
      mat.opacity = damp(mat.opacity, to, 10, anim ? dt : 1)
      if (Math.abs(mat.opacity - to) > 0.005) dirty = true
    }

    if (dirty) {
      renderer.render(scene, camera)
      dirty = false
    }
    const next = running && (anim || explode < 1 || Math.abs(view.vAz) > 1e-4 || Math.abs(view.az - view.targetAz - sway) > 1e-3)
    // the callouts move with the frames the view draws (the anchors only change then); once the view stops, they
    // finish their glide on frames of their own
    hooks.onFrame?.(next)
    if (next) raf = requestAnimationFrame(frame)
  }

  function kick() {
    if (!running || raf) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }

  function setRunning() {
    const on = visible && document.visibilityState === 'visible'
    if (on === running) return
    running = on
    if (on) kick()
    else if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  // pointer: drag to turn, hover and click to pick a part
  const ray = new Raycaster()
  const ndc = new Vector2()
  let drag = null
  const el = renderer.domElement
  const pick = (e) => {
    const r = el.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    return ray.intersectObjects(pickables, false)[0]?.object.userData.part ?? null
  }
  el.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }
    view.vAz = 0
  })
  el.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id && e.buttons) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.moved += Math.abs(dx) + Math.abs(dy)
      if (drag.moved > 4 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId)
      drag.x = e.clientX
      drag.y = e.clientY
      view.targetAz -= dx * 0.006
      view.vAz = -dx * 0.006 * 0.5
      view.targetEl = clamp(view.targetEl + dy * 0.004, 0.22, 1.1)
      view.lastUser = performance.now()
      dirty = true
      kick()
      return
    }
    const part = pick(e)
    el.style.cursor = part ? 'pointer' : ''
    if (part !== lit) hooks.onHover?.(part)
  })
  el.addEventListener('pointerup', (e) => {
    if (drag && drag.moved <= 4) {
      const part = pick(e)
      if (part) hooks.onPick?.(part)
    }
    drag = null
  })
  el.addEventListener('pointercancel', () => (drag = null))
  el.addEventListener('pointerleave', () => {
    if (!drag && lit) hooks.onHover?.(null)
  })

  const ro = new ResizeObserver(resize)
  ro.observe(container)
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    setRunning()
  })
  io.observe(container)
  const onVis = () => setRunning()
  document.addEventListener('visibilitychange', onVis)

  resize()
  place(explode)
  aimCamera()
  renderer.render(scene, camera)

  const anchorsAt = {
    // pads sit on each part's bare edge, never on its printed marking, on the side facing the part's callout column
    fan: () => new Vector3(FAN.x - 13, fanLayer.position.y + 5.5, FAN.z + 13),
    soc: () => new Vector3(P.soc.x - P.soc.w / 2 + 2.5, T + 2, P.soc.z + P.soc.d / 2 - 2.5),
    // the corner farthest from the SoC, facing the right-hand column: its leader never crosses the chip's marking
    ram: () => new Vector3(P.ram.x + P.ram.w / 2 - 2, T + P.ram.h, P.ram.z - P.ram.d / 2 + 2),
    // RP1 sits behind the USB/Ethernet stack; its front-left corner stays visible from the default view
    rp1: () => new Vector3(P.rp1.x - P.rp1.w / 2 + 2, T + P.rp1.h, P.rp1.z + P.rp1.d / 2 - 2),
    pmic: () => new Vector3(P.pmic.x - P.pmic.w / 2 + 1.2, T + P.pmic.h, P.pmic.z + P.pmic.d / 2 - 1.2),
    wifi: () => new Vector3(P.wifi.x - P.wifi.w / 2 + 2, T + P.wifi.h, P.wifi.z + P.wifi.d / 2 - 2),
    // the M.2 screw at the drive's far end, so the leader never crosses the label
    ssd: () => new Vector3(SSD.x + SSD.w / 2 - 2.5, baseLayer.position.y - 3.8, SSD.z),
  }
  const tmp = new Vector3()

  return {
    mode: '3d',
    update(next) {
      Object.assign(v, next)
      dirty = true
      kick()
    },
    anchors() {
      const out = {}
      for (const [k, f] of Object.entries(anchorsAt)) {
        tmp.copy(f())
        tmp.project(camera)
        out[k] = { x: ((tmp.x + 1) / 2) * size.w, y: ((1 - tmp.y) / 2) * size.h, visible: tmp.z < 1 }
      }
      return out
    },
    light(part) {
      lit = part
      dirty = true
      kick()
    },
    refresh() {
      dirty = true
      kick()
    },
    dispose() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      ribbon.body.geometry.dispose()
      ribbon.glowStrip.geometry.dispose()
      for (const d of disposables) d.dispose?.()
      renderer.dispose()
      renderer.forceContextLoss()
      el.remove()
    },
  }
}
