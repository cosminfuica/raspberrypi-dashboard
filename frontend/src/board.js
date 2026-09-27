// Geometry of the Pi 5 in its Argon NEO 5 stack, in millimetres. Shared by the 3D scene and the 2D drawing.
// Frame: x along the 85 mm edge (USB/Ethernet at +x), z along the 56 mm edge (HDMI/USB-C at +z, GPIO at −z).
// Positions follow Raspberry Pi's mechanical drawing (RP-008347-DS) and a top-down photo of the board.

export const BOARD = { w: 85, d: 56, t: 1.6 }
export const HOLES = [
  [-39, -24.5],
  [19, -24.5],
  [-39, 24.5],
  [19, 24.5],
]
export const HOLE_R = 1.35

// Parts: centre x/z, footprint w (x) × d (z), height h above the board top.
export const PARTS = {
  soc: { x: -9.4, z: 4.5, w: 16, d: 16, h: 1.9, label: 'BCM2712' },
  ram: { x: -9.4, z: -11.8, w: 15, d: 11, h: 1.0, label: 'LPDDR4X' },
  rp1: { x: 15.3, z: -7.3, w: 12, d: 12, h: 1.0, label: 'RP1' },
  pmic: { x: -31.4, z: 12.4, w: 6, d: 6, h: 0.9, label: 'PMIC' },
  wifi: { x: -29.8, z: -15.2, w: 11, d: 12.5, h: 1.5, label: 'Wi-Fi' },
  gpio: { x: -10.2, z: -25.8, w: 50.8, d: 5.1, h: 2.5 },
  fanHdr: { x: 24.6, z: -24.4, w: 5, d: 3.2, h: 4.2 },
  usb2: { x: 36.5, z: -19, w: 17, d: 14.5, h: 16 },
  usb3: { x: 36.5, z: -1.1, w: 17, d: 14.5, h: 16 },
  eth: { x: 34.5, z: 17.8, w: 21, d: 16, h: 13.5 },
  hdmi0: { x: -16.7, z: 25.2, w: 7.5, d: 7.5, h: 3.5 },
  hdmi1: { x: -3.3, z: 25.2, w: 7.5, d: 7.5, h: 3.5 },
  usbc: { x: -31.3, z: 25.2, w: 9, d: 7.5, h: 3.2 },
  cam1: { x: 6.4, z: 18.4, w: 3.4, d: 13.5, h: 1.3 },
  cam0: { x: 12.3, z: 18.4, w: 3.4, d: 13.5, h: 1.3 },
  pcie: { x: -40.2, z: -4.5, w: 3.4, d: 12.5, h: 1.3 },
  phy: { x: 21.3, z: 3.9, w: 5, d: 5, h: 0.8 },
  poe: { x: 18.7, z: 15.2, w: 5.1, d: 5.1, h: 2.5 },
  eeprom: { x: 13.6, z: -20.7, w: 4, d: 5, h: 0.9 },
  uart: { x: -10.2, z: 23.2, w: 5, d: 3.4, h: 3.2 },
  bat: { x: -23.8, z: 22.6, w: 4, d: 3.4, h: 3.2 },
  button: { x: -41.3, z: 9, w: 2.4, d: 3.6, h: 1.6 },
}

// The NEO 5 blower sits over the SoC; the M.2 base carries a 2280 SSD under the board.
export const FAN = { x: PARTS.soc.x, z: PARTS.soc.z, r: 15, hub: 6.2 }
export const SSD = { x: 2, z: -2, w: 80, d: 22, ctrl: { x: -29, z: -2, w: 8, d: 8 }, nand: { x: -7, z: -2, w: 13, d: 14 } }
export const LAYERS = { fan: 30, board: 0, base: -30 } // exploded heights (mm), final pose

// Live callouts: which part each reading belongs to, which section it links to, where it sits.
export const CALLOUTS = [
  { part: 'fan', href: '#fan', name: 'Blower fan', side: 'left' },
  { part: 'soc', href: '#cpu', name: 'SoC · BCM2712', side: 'left' },
  { part: 'wifi', href: '#network', name: 'Wi-Fi', side: 'left' },
  { part: 'pmic', href: '#power', name: 'PMIC', side: 'left' },
  { part: 'ram', href: '#memory', name: 'RAM · LPDDR4X', side: 'right' },
  { part: 'rp1', href: '#thermals', name: 'RP1 I/O', side: 'right' },
  { part: 'ssd', href: '#storage', name: 'NVMe · SN580', side: 'right' },
]

// Copper nets that light up with live traffic: Wi-Fi (wlan0 → SoC) and PCIe (SoC → the FFC to the NVMe base).
// Polylines route at 0/45/90° between pads, like real traces. The SoC-RAM bus is built in scene3d.js.
export const NETS = {
  wifi: { lanes: 4, pitch: 1.1, path: [[-24.1, -12.5], [-21, -9.4], [-21, 1.5], [-17.4, 1.5]] },
  pcie: { lanes: 4, pitch: 1.0, path: [[-17.4, 7.5], [-24, 7.5], [-27, 4.5], [-33, 4.5], [-36, -1.5], [-38.4, -1.5]] },
}
