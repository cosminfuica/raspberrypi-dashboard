// The GET /api/history series: name -> where to read it in a metrics snapshot. Same keys, same order as
// backend/pidash/app.py SERIES (series.test.js pins both to backend/tests/API.md). An unavailable fan or power
// section carries no numbers, hence the guards.
export const SERIES = {
  cpu_pct: (m) => m.cpu?.usage_pct,
  cpu_freq_mhz: (m) => m.cpu?.freq_mhz,
  load_1m: (m) => m.cpu?.load_avg?.[0],
  soc_temp_c: (m) => m.temps?.soc_c,
  nvme_temp_c: (m) => m.temps?.nvme_c,
  fan_rpm: (m) => (m.fan?.available ? m.fan.rpm : null),
  fan_pct: (m) => (m.fan?.available ? m.fan.speed_pct : null),
  mem_used_pct: (m) => m.memory?.ram.used_pct,
  swap_used_pct: (m) => m.memory?.swap.used_pct,
  disk_read_bytes_per_s: (m) => m.disks?.total.read_bytes_per_s,
  disk_write_bytes_per_s: (m) => m.disks?.total.write_bytes_per_s,
  net_rx_bytes_per_s: (m) => m.network?.total.rx_bytes_per_s,
  net_tx_bytes_per_s: (m) => m.network?.total.tx_bytes_per_s,
  pmic_w: (m) => (m.power?.available ? m.power.pmic_w : null),
}
