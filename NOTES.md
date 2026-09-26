# Notes: things that need your attention

Last updated by task t_a1dd6c7f (backend, WebSocket stream, fan control).

## Needs you

1. **Where the dashboard should listen on the Pi.** Pick one for the deploy task. Both are tailnet-only:
   - **Recommended:** the default `127.0.0.1`, published with `tailscale serve`.
     - HTTPS needs "HTTPS Certificates" turned on in the Tailscale admin console (DNS page). It is off today.
     - Without it, `tailscale serve` can still do plain HTTP.
   - Or bind the Tailscale IP directly: `PIDASH_HOST=100.106.106.35`. You would open `http://raspberrypi:8787`.

   Don't bind `0.0.0.0`: `wlan0` is on your home LAN and the Pi has no firewall.
2. **Docker panel = the `docker` group.** Showing containers means adding the dashboard's service user to the `docker` group, which is root-equivalent. The alternative is to leave the panel "unavailable". Your call at install time.
   - Without the group, the panel says: "permission denied: /var/run/docker.sock (add the service user to the docker group)". Checked on the Pi.
3. **SSH key (optional, convenience).** This desktop's key isn't in the Pi's `~/.ssh/authorized_keys`, so agents log in with the password. To switch to key login, run once: `ssh-copy-id cosmin@100.106.106.35`.

## Heads-up (no action needed)

- **How fan control works now** (details: docs/PI_RECON.md → "Verified on the hardware"):
  - While the dashboard runs, its own 1-second loop drives the fan from the chosen profile. The kernel's `config.txt` curve is parked, not deleted.
  - Whenever the dashboard stops, crashes or hangs, the fan goes to full speed for a few seconds and the kernel's `config.txt` curve takes over again. All three cases were tested on the Pi.
  - Above 80 °C the fan is forced to 100 % whatever the profile, until the SoC is below 75 °C. The kernel's 110 °C emergency trip is never touched.
  - The **Balanced** profile reproduces your `config.txt` curve, so installing the dashboard changes nothing until you pick another profile.
  - `config.txt` is never edited and no reboot is ever needed.
- **Privileges.** The service runs as an unprivileged `pidash` user. A udev rule ([deploy/90-pidash-fan.rules](deploy/90-pidash-fan.rules)) lets that group write the fan speed and the four fan trip points, and nothing else. No sudo and no root helper.
- **Your fan can run much slower than expected.** It starts from standstill at 4 % (about 270 rpm) and peaks at about 9,300 rpm. The dashboard never runs it below 8 % (about 670 rpm) unless it is off.
- **Hardware test on 2026-09-27, all cleaned up.** The backend ran on the Pi from a temp dir as a temporary `pidash` user with the udev rule, for about 45 minutes. During that time:
  - the fan was run through its whole range, including full speed, several times;
  - the CPU was loaded for about 3 minutes (the SoC peaked at 60 °C; no throttling);
  - the service was killed and hung on purpose to test the fail-safe.

  Removed afterwards: the service, the `pidash` user and group, the udev rule, the temp dir, and the pip cache the test install created. The sysfs permissions were reset. End state: trip points 55/63/70/75 °C, fan at 0 rpm, kernel in charge.
- **Your config repo has an outdated note.** `argon-neo5-fan/README.md` → Pitfalls says the trip points are read-only because `CONFIG_THERMAL_WRITABLE_TRIPS` is unset.
  - On this 6.18 kernel they are root-writable at runtime: that option no longer exists, and device-tree trips are always writable.
  - Details and kernel-source references are in docs/PI_RECON.md. Nothing was changed in that repo.
- **The Pi runs Debian 13 (trixie), not Bookworm.** Python is 3.13, there's no Node.js, and psutil 7.0 is available from apt. Everything targets that.
- **Services panel.** A service you enable or disable shows its new state within a minute (listing unit files is slow on the Pi, so it is cached). Start/stop state is live.
