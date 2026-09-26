"""Collectors: the parsers against real Pi output, fail-soft behaviour, and the mock data."""

import json
import os
import time
import unittest
from unittest import mock

from contract import example, shape_errors
from pidash import collectors
from pidash.app import SECTIONS, Hub
from pidash.collectors import (Collector, docker_health, docker_ports, iface_kind, parse_pmic, parse_tailscale,
                               parse_throttled, rfc3339, systemd_bytes, systemd_time, wifi_signal)
from pidash.mock import MockCollector

METRICS = example("### GET /api/metrics")

# `vcgencmd pmic_read_adc` on the Pi (2026-09-27, idle)
PMIC = """\
 3V7_WL_SW_A current(0)=0.07709848A
   3V3_SYS_A current(1)=0.04782057A
   1V8_SYS_A current(2)=0.11515970A
  DDR_VDD2_A current(3)=0.00780744A
  DDR_VDDQ_A current(4)=0.00000000A
   1V1_SYS_A current(5)=0.17664330A
    0V8_SW_A current(6)=0.33084030A
  VDD_CORE_A current(7)=0.94657990A
   3V3_DAC_A current(17)=0.00146520A
   3V3_ADC_A current(18)=0.00140415A
   0V8_AON_A current(16)=0.00494505A
      HDMI_A current(22)=0.01697190A
 3V7_WL_SW_V volt(8)=3.69049700V
   3V3_SYS_V volt(9)=3.29982600V
   1V8_SYS_V volt(10)=1.79633500V
  DDR_VDD2_V volt(11)=1.10805800V
  DDR_VDDQ_V volt(12)=0.60329610V
   1V1_SYS_V volt(13)=1.10146400V
    0V8_SW_V volt(14)=0.80219700V
  VDD_CORE_V volt(15)=0.72097620V
   3V3_DAC_V volt(20)=3.30402600V
   3V3_ADC_V volt(21)=3.29670000V
   0V8_AON_V volt(19)=0.79941320V
      HDMI_V volt(23)=5.11612000V
     EXT5V_V volt(24)=5.11478000V
      BATT_V volt(25)=0.01880340V
"""

WIRELESS = """\
Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
 wlan0: 0000   59.  -51.  -256        0      0      0     18      0        0
"""

TAILSCALE = {
    "Version": "1.102.4-t2b8f1e4a3-g1c3d2e1f0",
    "BackendState": "Running",
    "Self": {"HostName": "raspberrypi", "DNSName": "raspberrypi.example-tailnet.ts.net.", "OS": "linux",
             "TailscaleIPs": ["100.106.106.35", "fd7a:115c:a1e0::ce2d:6a24"], "Online": True, "Relay": "fra",
             "KeyExpiry": "2027-03-24T13:34:58Z", "LastSeen": "0001-01-01T00:00:00Z"},
    "Peer": {
        "nodekey:a": {"HostName": "omarchy", "DNSName": "omarchy.example-tailnet.ts.net.", "OS": "linux",
                      "TailscaleIPs": ["100.77.59.21"], "Online": True, "Active": True, "CurAddr": "192.0.2.10:41641",
                      "Relay": "fra", "RxBytes": 61708, "TxBytes": 84708, "LastSeen": "0001-01-01T00:00:00Z",
                      "ExitNode": False},
        "nodekey:b": {"HostName": "Cosmins-MacBook-Pro", "DNSName": "cosmins-macbook-pro.example-tailnet.ts.net.",
                      "OS": "macOS", "TailscaleIPs": ["100.85.185.115"], "Online": False, "Active": False,
                      "CurAddr": "", "Relay": "fra", "RxBytes": 0, "TxBytes": 0,
                      "LastSeen": "2026-09-26T17:30:00.123456789Z", "ExitNode": False},
        "nodekey:c": {"HostName": "pixel", "DNSName": "pixel.example-tailnet.ts.net.", "OS": "android",
                      "TailscaleIPs": ["100.90.12.44"], "Online": True, "Active": True, "CurAddr": "", "Relay": "fra",
                      "RxBytes": 5, "TxBytes": 6, "LastSeen": "0001-01-01T00:00:00Z", "ExitNode": True},
        "nodekey:d": {"HostName": "nas", "DNSName": "nas.example-tailnet.ts.net.", "OS": "linux",
                      "TailscaleIPs": ["100.64.0.9"], "Online": True, "Active": False, "CurAddr": "", "Relay": "",
                      "RxBytes": 0, "TxBytes": 0, "LastSeen": "0001-01-01T00:00:00Z", "ExitNode": False},
    },
}


class Parsers(unittest.TestCase):
    def test_throttled(self):
        t = parse_throttled("throttled=0x50005\n")
        self.assertEqual(t["raw"], "0x50005")
        self.assertEqual([k for k, v in t["now"].items() if v], ["under_voltage", "throttled"])
        self.assertEqual([k for k, v in t["since_boot"].items() if v], ["under_voltage", "throttled"])
        self.assertEqual(parse_throttled("throttled=0x0")["now"], METRICS["throttling"]["now"])

    def test_pmic(self):
        p = parse_pmic(PMIC)
        self.assertEqual(shape_errors({k: v for k, v in METRICS["power"].items() if k != "available"}, p), [])
        self.assertEqual((p["input_v"], p["core_v"], p["core_a"]), (5.115, 0.721, 0.947))
        self.assertEqual(len(p["rails"]), 12)  # EXT5V and BATT have no current: not rails
        self.assertEqual(p["rails"][0]["name"], "VDD_CORE")
        self.assertEqual([r["w"] for r in p["rails"]], sorted((r["w"] for r in p["rails"]), reverse=True))
        self.assertAlmostEqual(p["pmic_w"], sum(r["w"] for r in p["rails"]), delta=0.01)
        with self.assertRaises(collectors.Unavailable):
            parse_pmic("error=1 error_msg=\"Command not registered\"")

    def test_wifi_signal(self):
        self.assertEqual(wifi_signal(WIRELESS), {"wlan0": -51})
        self.assertEqual(wifi_signal(None), {})

    def test_tailscale(self):
        ts = parse_tailscale(TAILSCALE)
        self.assertEqual(shape_errors({k: v for k, v in METRICS["tailscale"].items() if k != "available"}, ts), [])
        self.assertEqual(ts["version"], "1.102.4")
        self.assertEqual(ts["self"]["dns_name"], "raspberrypi.example-tailnet.ts.net")
        self.assertEqual(ts["self"]["key_expiry"], 1805895298)
        self.assertEqual(ts["summary"], {"peers": 4, "online": 3})
        by_host = {p["hostname"]: p for p in ts["peers"]}
        self.assertEqual({h: p["connection"] for h, p in by_host.items()},
                         {"omarchy": "direct", "Cosmins-MacBook-Pro": "offline", "pixel": "relay", "nas": "idle"})
        self.assertEqual(by_host["Cosmins-MacBook-Pro"]["last_seen"], 1790443800)
        self.assertIsNone(by_host["omarchy"]["last_seen"])
        self.assertIsNone(by_host["nas"]["relay"])
        self.assertEqual(ts["peers"][-1]["hostname"], "Cosmins-MacBook-Pro")  # offline peers last

    def test_small_parsers(self):
        self.assertEqual(systemd_time("@1790358131"), 1790358131)
        self.assertIsNone(systemd_time(""))
        self.assertEqual(systemd_bytes("98304000"), 98304000)
        self.assertIsNone(systemd_bytes("[not set]"))
        self.assertIsNone(systemd_bytes(str(2**64 - 1)))
        self.assertIsNone(rfc3339("0001-01-01T00:00:00Z"))
        self.assertEqual(docker_health("Up 3 hours (healthy)"), "healthy")
        self.assertEqual(docker_health("Up 1 second (health: starting)"), "starting")
        self.assertIsNone(docker_health("Exited (0) 2 days ago"))
        self.assertEqual(docker_ports([{"IP": "0.0.0.0", "PrivatePort": 8123, "PublicPort": 8123, "Type": "tcp"},
                                       {"IP": "::", "PrivatePort": 8123, "PublicPort": 8123, "Type": "tcp"},
                                       {"PrivatePort": 1883, "Type": "tcp"}]),
                         ["1883/tcp", "0.0.0.0:8123->8123/tcp", "[::]:8123->8123/tcp"])
        self.assertEqual([iface_kind(n) for n in ("wlan0", "eth0", "tailscale0", "docker0", "br-1a2b", "usb0")],
                         ["wifi", "ethernet", "vpn", "bridge", "bridge", "other"])


class FailSoft(unittest.TestCase):
    """Whatever machine the tests run on, every section is either well-formed or reports why not."""

    def check(self, c):
        c.cpu(), c.disks(), c.network(), c.processes()  # rate baselines
        time.sleep(0.3)
        for name in SECTIONS:
            if name == "fan":
                continue  # owned by FanController, tested in test_fan
            with self.subTest(name):
                self.assertEqual(shape_errors(METRICS[name], getattr(c, name)()), [])
        info, ex = c.info(), example("### GET /api/info")
        self.assertEqual(shape_errors({k: ex[k] for k in info if k != "limits"}, {k: v for k, v in info.items() if k != "limits"}), [])
        self.assertEqual(set(info["limits"]), {"nvme_warn_c", "nvme_crit_c"})  # the app adds the fixed limits

    def test_this_machine(self):
        self.check(Collector())

    def test_without_commands_or_docker(self):
        with mock.patch.dict(os.environ, {"PATH": "/nonexistent"}), \
                mock.patch.object(collectors, "DOCKER_SOCK", "/nonexistent/docker.sock"):
            c = Collector()
            self.check(c)
            for name in ("throttling", "power", "services", "docker", "tailscale"):
                self.assertFalse(getattr(c, name)()["available"], name)
            self.assertEqual(c.docker()["error"], "docker socket not found: /nonexistent/docker.sock")
            self.assertEqual(c.tailscale()["error"], "tailscale not found")

    def test_a_crashing_collector_nulls_its_section_only(self):
        class Broken(MockCollector):
            def memory(self):
                raise RuntimeError("boom")

        fan = mock.Mock(status=lambda: {"available": False, "error": "no fan"})
        hub = Hub(Broken(), fan)
        with self.assertLogs("pidash", "ERROR") as logs:
            first = hub.collect(SECTIONS)
            second = hub.collect(SECTIONS)
        self.assertIsNone(first["memory"])
        self.assertIsNotNone(second["cpu"])
        self.assertEqual(len(logs.output), 1)  # logged once, not every second


class Mock(unittest.TestCase):
    def test_shapes_and_motion(self):
        c = MockCollector()
        first = {name: getattr(c, name)() for name in SECTIONS if name != "fan"}
        for name, value in first.items():
            with self.subTest(name):
                self.assertEqual(shape_errors(METRICS[name], value), [])
        self.assertNotEqual(first["cpu"], c.cpu())
        self.assertNotEqual(first["network"]["interfaces"][0]["rx_total_bytes"],
                            c.network()["interfaces"][0]["rx_total_bytes"])
        self.assertTrue(json.dumps(first))


if __name__ == "__main__":
    unittest.main()
