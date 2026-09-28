# Notes: things that need your attention

Last updated by task t_f223b99e (final check), 2026-09-27.

## Needs you

1. **Review the dashboard, then say "install it on the Pi".** Nothing is installed on the Pi right now; the trial install below was fully removed. The visual QA pass (task t_d949efc5) is done; its summary is the next section.
   - **Try it on this desktop** with demo data: `cd backend && PIDASH_TOKEN=dev .venv/bin/pidash --mock --port 18787`, then open http://127.0.0.1:18787. The token for fan changes is `dev`. Port 18787 because another app on this desktop already uses 8787.
   - Real-Pi screenshot and a 10-second tour: `docs/screenshots/live-pi.png`, `docs/screenshots/tour.gif`.
2. **When you install**, follow [README.md → Install on the Pi](README.md#install-on-the-pi). It takes three commands, and `sudo` needs your password on the Pi.
   - Build the UI on this desktop and rsync the checkout to the Pi. The Pi has no Node.js.
   - `install.sh` prints the **auth token once**. Save it, e.g. in your password manager. You type it into the dashboard the first time you change the fan.
   - Then open **`http://raspberrypi:8787`** on this desktop. Use the name, not the `100.x` IP: `tailscale serve` answers the bare IP with 404.
3. **Optional: HTTPS.** You chose plain HTTP for now. If you later turn on "HTTPS Certificates" in the Tailscale admin console (DNS page), run `sudo tailscale serve --bg --https=443 http://127.0.0.1:8787` on the Pi. See README → Open it from your desktop. This path is untested, because certificates are off on your tailnet.
4. **Reboot, update and service restart (task t_ff7f55c4) need a re-install.** The page has the controls since task t_4fc096f8: a System card (update with its live apt log, reboot) and a restart button on each Services row. When you re-run `install.sh` it adds `/etc/sudoers.d/pidash`, which lets the `pidash` user run exactly three root commands: reboot, start the update unit, and restart one service. It also removes `NoNewPrivileges=yes` from the unit, because that setting would block sudo. Details: docs/API.md → System actions. Your installed copy is unchanged until then. It was tested in a Debian trixie container (the Pi's sudo 1.9.16) and with read-only checks on the Pi. A real reboot or update on the Pi was not run.
5. **The web console (task t_a0833a14) is on by default after the re-install.** It gives whoever has the token a shell as the `pidash` user, and that user is in the `docker` group, so in effect root. If you'd rather not, add `PIDASH_CONSOLE=0` to `/etc/pidash/pidash.env` and restart the service. The terminal is the page's Console card (key `-`) since task t_4fc096f8. Details: docs/API.md → Console.
6. **Shut down, service logs and the home-screen app (task t_160063d5) also need the re-install.** It adds a fourth root command, `systemctl poweroff` (the System card's Shut down; the Pi then stays off until you press its power button), and puts `pidash` in the `systemd-journal` group so the logs button on each Services row can read that service's journal. On a phone, open the dashboard and use the browser's **Add to Home screen**. What each adds and why: [docs/FEATURES.md](docs/FEATURES.md). A real shutdown of the Pi was not run; the logs were read for real on the Pi, read-only.

## Visual QA pass (task t_d949efc5, 2026-09-27)

Checked in headless Chromium on the desktop GPU against the mock backend, and against **real Pi data**: a throwaway read-only server on the Pi (no token, fan control off) under a 100-second 4-core load. Screens covered: 1920, 1440, 1280, 1024, 820, 390 and 360 px; 13 edge cases replayed through the real UI; keyboard, reduced motion and low power. Everything below is fixed and re-checked. Frontend only; backend and install are unchanged.

**What you'll notice**

- **Smoother, lighter page.** An idle page cost about a third of a CPU core in forced layout: the callouts re-measured the page every frame, twice. Idle is now 60 fps with 1 layout per frame, and CPU time dropped by roughly a third. Low-power mode fell from 43 layouts a second to 3; its numbers and rows now snap instead of easing. The 3D shadows are drawn once instead of every frame, and a backdrop blur behind the callouts, which cost about a third of the GPU time, is gone.
- **The 3D board reacts to the real Pi.** Under load it showed SoC 44 → 56 °C, CPU 100 %, and the fan spinning up to about 3,000 rpm under the kernel curve, then back to 0. A hot SoC now glows too; before, its metal lid looked the coolest part on the board.
- **Callouts stay tidy.** Their boxes always follow the parts' top-to-bottom order, so leaders no longer cross. The model is sized to fit between the two callout columns at every width, and the RAM, RP1, Wi-Fi and SoC leaders avoid the ports in the 2D view.
- **Edge cases.** A crashed collector dims its section with "No data" instead of showing old numbers as live. "DNP" (do not populate) notes now say what is missing and why. Long IPv6 addresses wrap instead of being cut. Readings no longer overflow at 360 px, and a long hostname gives way before the header controls.
- **Fan card and curve editor.**
  - Under the kernel curve the saved profile is outlined and marked "saved", not shown as running. "Changes are off" appears above the profiles.
  - The editor's buttons line up in two columns. The drag tooltip stays readable over the curves, the help text is shorter per line, and only the handle you hold is ringed.
- **New:** a 10-second tour, `docs/screenshots/tour.gif`. Every screenshot is refreshed; `live-pi.png` shows your Pi.

**Left as is**

- Some leaders still pass over a port block on their way to the chip, and pads can sit close together when you turn the board by hand. No two ever cross.
- The Pi stayed untouched: the test server, its temp dir and the load were removed, and no pip cache was left. The fan is back at 0 rpm under the kernel with trips 55/63/70/75 °C.

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
- **Privileges.** The service runs as an unprivileged `pidash` user. A udev rule ([deploy/90-pidash-fan.rules](deploy/90-pidash-fan.rules)) lets that group write the fan speed and the four fan trip points, and nothing else. Since task t_ff7f55c4 a sudoers drop-in ([deploy/pidash.sudoers](deploy/pidash.sudoers)) also lets it run exactly three root commands, for the dashboard's reboot, system update and service restart: see docs/API.md → System actions. Task t_160063d5 added a fourth, `systemctl poweroff` for Shut down, and the `systemd-journal` group (read-only) for the service logs.
- **Your fan can run much slower than expected.** It starts from standstill at 4 % (about 270 rpm) and peaks at about 9,300 rpm. The dashboard never runs it below 8 % (about 670 rpm) unless it is off.
- **Services panel.** A service you enable or disable shows its new state within a minute (listing unit files is slow on the Pi, so it is cached). Start/stop state is live.
