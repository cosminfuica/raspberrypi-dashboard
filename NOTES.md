# Notes: things that need your attention

Last updated by task t_8101fb1f (new functionalities, deployed), 2026-09-29.

## Needs you

1. **It's live: open `http://raspberrypi:8787`.** Version 0.2.0 is installed on the Pi (re-installed 2026-09-29 with `install.sh`; your token, settings and fan profile were kept). A page you already had open reloads itself onto the new version within a few seconds; the server now tells browsers to re-check the page on every load, so a plain refresh is always enough after future updates.
   - **What's new:** a System card (Update with a live apt log, Reboot, Shut down), a Restart and a Logs button on every Services row, a Console card (a real shell on the Pi), sign-in with a lock/unlock state, the nav highlight fix, and an installable home-screen app. Tour: [README.md](README.md), details and reasons: [docs/FEATURES.md](docs/FEATURES.md).
   - **Sign in** with the token that `install.sh` printed at the first install. To see it again, on the Pi: `sudo grep TOKEN /etc/pidash/pidash.env`.
   - **Keys:** <kbd>1</kbd>–<kbd>0</kbd>, <kbd>-</kbd> (Console) and <kbd>=</kbd> (System) jump between sections; <kbd>/</kbd> searches the services.
2. **The console is on.** It gives whoever has the token a shell as the `pidash` user, and that user is in the `docker` group, so in effect root. If you'd rather not, add a line `PIDASH_CONSOLE=0` to `/etc/pidash/pidash.env` and run `sudo systemctl restart pidash`. Details: docs/API.md → Console.
3. **Optional: HTTPS.** You chose plain HTTP for now. If you later turn on "HTTPS Certificates" in the Tailscale admin console (DNS page), run `sudo tailscale serve --bg --https=443 http://127.0.0.1:8787` on the Pi. See README → Configuration. This path is untested, because certificates are off on your tailnet.
4. **Optional, on GitHub:** a social preview image (Settings → Social preview; there's no API for it) and repo topics such as `raspberry-pi`, `dashboard`, `tailscale`. Not done, because both change how the public repo presents itself.
5. **Try it on this desktop** with demo data: `cd backend && PIDASH_TOKEN=dev .venv/bin/pidash --mock --port 18787`, then open http://127.0.0.1:18787 (sign in with `dev`). Port 18787 because another app on this desktop already uses 8787. Or, with no backend at all: `cd frontend && npm run dev`, then http://localhost:5173/?demo (sign in with `demo`).

## Deploy of 2026-09-29 (task t_8101fb1f)

All six sub-task branches are in `main` (a fast-forward) and pushed. On the desktop, `frontend/dist` was rebuilt; on the Pi, `~/pidash` was synced from it and `sudo ./install.sh` re-run.

**Checked on the real Pi, through the page** (headless Chromium from this desktop over Tailscale):

- A page left open from before the install reloaded itself onto 0.2.0 about 30 s after the restart, with 12 nav tabs and the new cards, and no page errors.
- Nav: clicking **2 Processor** lights Processor, and **3 Thermals** lights Thermals (your example).
- Sign-in with the real token; **Restart** of `cron.service` from its row ("cron restarted."), then its **Logs**, which showed the restart.
- **Console:** a command typed in the page ran on the Pi as `pidash` on `cosmin-pi`; `exit` closed it and said why.
- **System card:** Update, Reboot and Shut down each ask first (Cancel focused) and were cancelled. The update job's state reads fine (`idle`).
- Sign-out ends the session on the server. The audit log (`/var/lib/pidash/audit.log` and the journal) has each of these.
- On the Pi: `pidash` is in `video`, `systemd-journal` and `docker`; `sudo -l -U pidash` lists exactly the four commands; the service is active with 0 restarts; your saved fan profile (Performance) was re-applied.

**Not run on the real Pi, on purpose:** an actual system update, reboot or shutdown. They'd change or switch off your Pi; press them when it suits you. Update and reboot were run for real in a Debian trixie systemd container (the Pi's sudo 1.9.16): a real `apt-get upgrade` through the API (exit 0) and a real reboot through the API, plus a sudoers allow/deny matrix. Shut down uses the same sudo path (`systemctl poweroff`, which `sudo -l -U pidash` lists on the Pi); a real shutdown was not tested.

**Fixed while deploying:**

- Browsers could keep an old `index.html` after a re-install (it had no cache header), and then ask for files that no longer exist. The page, manifest and icons are now `Cache-Control: no-cache`; the content-hashed files in `/assets/` still cache normally.
- Your `/etc/pidash/pidash.env` still had the old line `# PIDASH_FAN_CONTROL=0   # read-only: ...`. Uncommented, systemd would have read the comment as part of the value and fan control would have stayed on. `install.sh` now splits such a line into a comment and the setting, and it did so on your Pi.
- The version is now 0.2.0 (it was 0.1.0), which is what makes open pages reload after an install.

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
- **New:** a 10-second tour, now `docs/images/tour.webp`. Every screenshot is refreshed; `live-pi.png` shows your Pi.

**Left as is**

- Some leaders still pass over a port block on their way to the chip, and pads can sit close together when you turn the board by hand. No two ever cross.
- The Pi stayed untouched: the test server, its temp dir and the load were removed, and no pip cache was left. The fan is back at 0 rpm under the kernel with trips 55/63/70/75 °C.

## Not tested

- **A real reboot, update or shutdown of the Pi** (see above: tested in a container, not on your Pi). The unit is enabled for `multi-user.target`. If the fan or its udev permissions appear after the service starts, the fan loop keeps retrying every 10 s. `tailscale serve --bg` settings persist across reboots.
- **Physical phones.** The phone layout and the console's touch key row were checked in an emulated 390 px touch viewport.

## Heads-up (no action needed)

- **Your answers are applied:**
  - The service binds `127.0.0.1` and `install.sh` publishes it with `tailscale serve` over plain HTTP on port 8787.
  - `install.sh` adds `pidash` to the `docker` group. `--no-docker` leaves it out.
  - SSH to the Pi now uses your key; the password was only used for `sudo`.
  - The outdated Pitfalls note in `argon-neo5-fan/README.md` was already fixed in your config repo (ca1436f, by task t_c7e64aa1).
- **`tailscale funnel` stays off.** Nothing here enables it, and the README warns against it: it would put the dashboard on the public internet.
- **No Docker Compose option.** Fan control needs host sysfs access through the udev rule, plus systemd's post-stop fan restore. A container would lose both. README → Troubleshooting → "Why is there no Docker image?" explains this.
- **End-to-end test on the real Pi, 2026-09-27.** `install.sh` ran from a temp copy. Everything was checked from this desktop over Tailscale at `http://raspberrypi:8787`:
  - Every API payload matched docs/API.md, and all 13 metric sections held real data. That included Docker 29.8.1 with 0 containers, 139 services and 2 tailnet peers. A throwaway test container (1 busy core, a health check, a port), removed afterwards, also showed up correctly: healthy, 25 % CPU of the whole machine, its memory and its port.
  - The WebSocket replayed history and then sent 1 tick per second: `processes` every 3 s; `power`, `services`, `docker` and `tailscale` every 5 s. A page from another origin was refused (403).
  - In headless Chromium, every panel filled in with real data and there were no console errors. The screenshot is [docs/screenshots/live-pi.png](docs/screenshots/live-pi.png).
  - Signing in and switching profiles worked from the browser: a wrong token was refused; Performance → pwm 101, about 3,920 rpm; Balanced → fan off.
- **Installer checks on the Pi (2026-09-27):**
  - Idempotent: two more `install.sh` runs kept the token and the saved profile (Performance was re-applied after each restart). `--no-docker` removed the docker group and a plain re-run added it back.
  - Crash recovery: two `SIGKILL`s → the fan went back to the kernel curve at once, and systemd restarted the service 5 s later with the saved profile.
  - `uninstall.sh` ran twice (the second run was a no-op). The Pi was back to exactly how it was before: trip points 55/63/70/75 °C, fan at 0 rpm, the kernel in charge, no `pidash` user, files, udev rule or serve config, and no pip cache.
- **Updating pidash later:** on the desktop, `git pull`, then `cd frontend && npm ci && npm run build`, rsync the checkout to `~/pidash` on the Pi, and run `sudo ./install.sh` there (README → Updating, "Built on another computer?"). Open pages reload on their own.
- **Privileges.** The service runs as an unprivileged `pidash` user. A udev rule ([deploy/90-pidash-fan.rules](deploy/90-pidash-fan.rules)) lets that group write the fan speed and the four fan trip points, and nothing else. A sudoers drop-in ([deploy/pidash.sudoers](deploy/pidash.sudoers)) lets it run exactly four root commands: reboot, power off, start the update unit, and restart one service. The `systemd-journal` group (read-only) gives it the service logs. See docs/API.md → System actions.
- **How fan control works** (details: docs/PI_RECON.md → "Verified on the hardware"):
  - While the dashboard runs, its own 1-second loop drives the fan from the chosen profile. The kernel's `config.txt` curve is parked, not deleted.
  - Whenever the dashboard stops, crashes or hangs, the fan goes to full speed for a few seconds and the kernel's `config.txt` curve takes over again.
  - Above 80 °C the fan is forced to 100 % whatever the profile, until the SoC is below 75 °C. The kernel's 110 °C emergency trip is never touched.
  - **Balanced** reproduces your `config.txt` curve, so installing the dashboard changes nothing until you pick another profile. `config.txt` is never edited and no reboot is ever needed.
- **Your fan can run much slower than expected.** It starts from standstill at 4 % (about 270 rpm) and peaks at about 9,300 rpm. The dashboard never runs it below 8 % (about 670 rpm) unless it is off.
- **Services panel.** A service you enable or disable shows its new state within a minute (listing unit files is slow on the Pi, so it is cached). Start/stop state is live.
