# Notes: things that need your attention

Last updated by task t_377b1784 (integration, installer, remote access), 2026-09-27.

## Needs you

1. **Review the dashboard, then say "install it on the Pi".** Nothing is installed on the Pi right now; the trial install below was fully removed. A visual QA pass (task t_d949efc5) runs next and adds its own summary here.
2. **When you install**, follow [README.md → Install on the Pi](README.md#install-on-the-pi). It takes three commands, and `sudo` needs your password on the Pi.
   - Build the UI on this desktop and rsync the checkout to the Pi. The Pi has no Node.js.
   - `install.sh` prints the **auth token once**. Save it, e.g. in your password manager. You type it into the dashboard the first time you change the fan.
   - Then open **`http://raspberrypi:8787`** on this desktop. Use the name, not the `100.x` IP: `tailscale serve` answers the bare IP with 404.
3. **Optional: HTTPS.** You chose plain HTTP for now. If you later turn on "HTTPS Certificates" in the Tailscale admin console (DNS page), run `sudo tailscale serve --bg --https=443 http://127.0.0.1:8787` on the Pi. See README → Open it from your desktop. This path is untested, because certificates are off on your tailnet.

## Not tested

- **A real reboot of the Pi.** Testing it would have meant rebooting your Pi. The unit is enabled for `multi-user.target`. If the fan or its udev permissions appear after the service starts, the fan loop keeps retrying every 10 s. `tailscale serve --bg` settings persist across reboots.

## Heads-up (no action needed)

- **Your answers are applied:**
  - The service binds `127.0.0.1` and `install.sh` publishes it with `tailscale serve` over plain HTTP on port 8787.
  - `install.sh` adds `pidash` to the `docker` group. `--no-docker` leaves it out.
  - SSH to the Pi now uses your key; the password was only used for `sudo`.
  - The outdated Pitfalls note in `argon-neo5-fan/README.md` was already fixed in your config repo (ca1436f, by task t_c7e64aa1).
- **`tailscale funnel` stays off.** Nothing here enables it, and the README warns against it: it would put the dashboard on the public internet.
- **No Docker Compose option.** Fan control needs host sysfs access through the udev rule, plus systemd's post-stop fan restore. A container would lose both. README → "Why there is no Docker image" explains this.
- **End-to-end test on the real Pi, 2026-09-27.** `install.sh` ran from a temp copy. Everything was checked from this desktop over Tailscale at `http://raspberrypi:8787`:
  - Every API payload matched docs/API.md, and all 13 metric sections held real data. That included Docker 29.8.1 with 0 containers, 139 services and 2 tailnet peers. A throwaway test container (1 busy core, a health check, a port), removed afterwards, also showed up correctly: healthy, 25 % CPU of the whole machine, its memory and its port.
  - The WebSocket replayed history and then sent 1 tick per second: `processes` every 3 s; `power`, `services`, `docker` and `tailscale` every 5 s. A page from another origin was refused (403).
  - In headless Chromium, every panel filled in with real data and there were no console errors. The screenshot is [docs/screenshots/live-pi.png](docs/screenshots/live-pi.png).
  - Signing in and switching profiles worked from the browser: a wrong token was refused; Performance → pwm 101, about 3,920 rpm; Balanced → fan off.
  - No contract mismatches were found, so the backend and frontend code are unchanged.
- **Installer checks on the Pi:**
  - Idempotent: two more `install.sh` runs kept the token and the saved profile (Performance was re-applied after each restart). `--no-docker` removed the docker group and a plain re-run added it back.
  - Crash recovery: two `SIGKILL`s → the fan went back to the kernel curve at once, and systemd restarted the service 5 s later with the saved profile.
  - `uninstall.sh` ran twice (the second run was a no-op). The Pi is back to exactly how it was before: trip points 55/63/70/75 °C, fan at 0 rpm, the kernel in charge, no `pidash` user, files, udev rule or serve config, and no pip cache.
- **How fan control works** (details: docs/PI_RECON.md → "Verified on the hardware"):
  - While the dashboard runs, its own 1-second loop drives the fan from the chosen profile. The kernel's `config.txt` curve is parked, not deleted.
  - Whenever the dashboard stops, crashes or hangs, the fan goes to full speed for a few seconds and the kernel's `config.txt` curve takes over again.
  - Above 80 °C the fan is forced to 100 % whatever the profile, until the SoC is below 75 °C. The kernel's 110 °C emergency trip is never touched.
  - **Balanced** reproduces your `config.txt` curve, so installing the dashboard changes nothing until you pick another profile. `config.txt` is never edited and no reboot is ever needed.
- **Privileges.** The service runs as an unprivileged `pidash` user. A udev rule ([deploy/90-pidash-fan.rules](deploy/90-pidash-fan.rules)) lets that group write the fan speed and the four fan trip points, and nothing else. No sudo and no root helper.
- **Your fan can run much slower than expected.** It starts from standstill at 4 % (about 270 rpm) and peaks at about 9,300 rpm. The dashboard never runs it below 8 % (about 670 rpm) unless it is off.
- **Services panel.** A service you enable or disable shows its new state within a minute (listing unit files is slow on the Pi, so it is cached). Start/stop state is live.
