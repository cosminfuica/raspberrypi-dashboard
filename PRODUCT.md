# Product

<!-- impeccable:product-schema 1 -->

Audience, visits and the contract status were confirmed by the owner in the init interview on 2026-10-23. The rest
comes from the README, the code and the first brief (kanban t_f223b99e, t_c7e64aa1); facts marked (inferred) are not
confirmed.

## Platform

web

## Users

Any Raspberry Pi 5 owner who runs the Pi as a home server, installs pidash from GitHub, and opens it over their
tailnet from a desktop browser or a phone. Their fan and case vary: the official Active Cooler, an Argon NEO 5, or
another fan on the Pi 5's FAN connector. The owner (Cosmin) is one of them and his Pi is the reference board.

The visits pidash must serve best, all four confirmed:

1. Glance: open it, read whether the Pi is healthy, close it.
2. Diagnose: find out why the Pi felt slow or ran hot, from the charts and sensors.
3. Change the fan profile: quieter or cooler, in seconds.
4. Act from the phone: update, reboot, restart a service, read its logs, open the console.

## Product Purpose

pidash shows how the Pi is running right now and over the last 10 minutes (thermals, CPU, memory, storage, network,
services, containers, tailnet), drives the fan from the curve the owner picks, and runs the Pi's chores (apt update,
reboot, shut down, service restarts and logs, a shell) from any device on the tailnet, without SSH, `config.txt`
edits or a reboot. Success: one glance answers "is it healthy, and if not, what is wrong", and a fan change or a
chore takes seconds.

## Positioning

It is made for the Raspberry Pi 5, not for any Linux host: it reads sensors other dashboards don't (PMIC rails and
power, the RP1 temperature, firmware throttle flags, the fan tach and PWM), pins each reading to its part on a model
of the board, and drives the fan curve itself at runtime, handing the fan back to `config.txt` whenever it stops. It
is not a multi-host monitoring stack.

## Operating Context

- Served by the Pi itself (FastAPI, port 8787, bound to `127.0.0.1`) and shared on the tailnet by `tailscale serve`;
  never the LAN or the public internet. An SSH tunnel is the documented fallback without Tailscale.
- Runs on 64-bit Raspberry Pi OS "trixie". Other Pi models are untested: the Pi-5-only readings show as unavailable.
- Live data over one WebSocket at about 1 Hz, with a 600 s history ring for the charts. The fan loop runs on the Pi
  whether or not a page is open.
- Looking needs no sign-in. Changes (the fan, updates, reboot, shut down, service restarts), service logs and the web
  console need the token that `install.sh` prints once; the browser trades it for a sign-in cookie that lasts 7 days.
  Every change is written to `/var/lib/pidash/audit.log`.
- Installs as a home-screen app (`frontend/public/manifest.webmanifest`, "pidash: Raspberry Pi dashboard").
- Anyone can try it without a Pi: `pidash --mock` and the page's `?demo` mode serve made-up data, labelled as demo
  data in the UI.
- The reference Pi: 8 GB RAM, 4 Cortex-A76 cores, Argon NEO 5 case with a WD SN580 NVMe, Wi-Fi as the main link,
  Docker installed (as recorded in September 2026).

## Capabilities and Constraints

- Contract: docs/API.md was the written contract for every field and message. The owner deleted it on purpose in
  c999bc7 (2026-10-23) and plans to rewrite it. Until then the contract has no written source; the last version is in
  git at `c999bc7^:docs/API.md`.
- Fan profiles: Silent, Balanced (the owner's own curve, the default), Performance, Max, and Custom (an editable
  curve of 2-8 points, 20-80 °C, with hysteresis). `PIDASH_FAN_CONTROL=0` leaves the fan to `config.txt`.
- Quiet at night: an optional schedule (off by default, Silent 23:00-07:00 pre-filled) that the backend applies on the
  Pi's clock. A pick inside the window pauses it for tonight only.
- Hard safety floor on the Pi side: failsafe at 80 °C (full speed until the SoC is below 75 °C, and whenever the
  temperature can't be read) and the kernel's 110 °C critical trip. The UI explains these but cannot change them.
- The web console is a real shell as the `pidash` user, which is in the root-equivalent `docker` group unless
  installed with `--no-docker`. It is off without a token.
- The frontend is static assets served by the backend; it must stay small and smooth on a desktop browser and on a
  phone.
- The first brief asked for a showpiece: striking visuals, motion and 3D. It must never read as a generic admin
  template.
- Open decision: the 3D board and the 2D drawing always model the reference build (Pi 5 in an Argon NEO 5 stack,
  blower over the SoC, NVMe in the base). How they should show a Pi with an Active Cooler, another fan or no NVMe is
  undecided.

## Brand Commitments

- Name `pidash` (repo `raspberrypi-dashboard`); the README banner line is "Mission control for your Raspberry Pi 5".
  MIT licence.
- Marks on hand: `docs/images/mark.svg`, the app icons and the healthy/warning/problem/offline favicons in
  `frontend/public/`.
- No Raspberry Pi logo. The Pi board in any image is captured from the app, never drawn by an image model, and text
  is set in the composition, never inside a generated image.
- The README media look is locked in `.github/readme/BRIEF.md`.
- The first brief's words: "a masterpiece", "nice aesthetics, cool animation and motions, 3D elements".

## Evidence on Hand

- One capture of the page running on the real Pi: `docs/screenshots/live-pi.png` (1440 x 900, 2026-09-27).
- Page captures on demo data: `docs/images/*.webp`, the README tiles and `demo.mp4` in `.github/readme/`.
- In-browser demo data: `frontend/src/demo/mock.js`; the hardware facts (board, sensors, fan mechanism, measured RPM at each
  PWM) were in docs/PI_RECON.md, deleted with docs/API.md in c999bc7 and recoverable from `c999bc7^`.
- No user testimonials, install counts, benchmarks or press. Don't invent them.

## Product Principles

1. Truth first: every number comes from the Pi with its unit; unknown values show as "—", never as a guess.
2. Health at a glance, detail on demand: the worst state on the board is the loudest thing on the screen.
3. The hardware is the hero: the visuals depict the Pi 5 and its real sensors, not abstract tech decoration.
4. Changing the fan is safe and reversible: the curve preview matches exactly what the Pi will do.
5. Any Pi 5, honestly: what a given Pi can't read or allow (no fan, no Docker access, no token) says so in words, not
   as an error or an empty panel. (inferred from the README's troubleshooting and the confirmed audience)

## Accessibility & Inclusion

WCAG AA contrast, full keyboard operation (including the curve editor; the number row jumps between sections and `/`
searches the services), `prefers-reduced-motion` honoured, and a 2D board switch (low-power mode) that turns the 3D
scene off. Touch controls are labelled in words, not icons or keycaps.
