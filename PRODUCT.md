# Product

<!-- impeccable:product-schema 1 -->

Inferred from the owner's brief (kanban t_f223b99e, t_c7e64aa1) without an interview: the design task ran headless. Facts marked (inferred) were not confirmed by the owner.

## Platform

web

## Users

One owner (Cosmin) watching his own Raspberry Pi 5 home server from a desktop browser over Tailscale, and sometimes from a phone. He built the Pi himself (Argon NEO 5 NVMe case, NVMe boot, a hand-written fan curve in config.txt), so he knows the hardware vocabulary. (inferred) Typical visits: a glance to check it is healthy, a look after something felt slow, and switching the fan profile when noise or heat matters.

## Product Purpose

pidash shows how the Pi is running right now and over the last 10 minutes (thermals, CPU, memory, storage, network, services, containers, tailnet) and lets the owner change the fan curve from any device on the tailnet, without SSH, config.txt edits or a reboot. Success: one glance answers "is it healthy, and if not, what is wrong", and a fan change takes seconds.

## Positioning

It is made for one board, this board: the Pi 5 in its NEO 5 case, with sensors other dashboards don't read (PMIC rails, RP1 temperature, firmware throttle flags, the pwm-fan tach) and a fan curve it drives itself at runtime. It is not a generic multi-host monitoring stack.

## Operating Context

- Served by the Pi itself (FastAPI, port 8787) and reached over the tailnet only; never the public internet.
- Live data over one WebSocket at about 1 Hz; a 600 s history ring for charts.
- Reads are open to the tailnet; changes (the fan, reboot, shutdown, update, service restarts), the service logs and the web console need a shared token, which the browser trades for a session cookie.
- The Pi has 8 GB RAM, 4 Cortex-A76 cores, a WD SN580 NVMe, Wi-Fi as the main link, Docker installed with zero containers today.

## Capabilities and Constraints

- Contract: docs/API.md is the source of truth for every field and message.
- Fan profiles: Silent, Balanced (the owner's existing curve, the default), Performance, Max, and Custom (an editable curve of 2–8 points, 20–80 °C, with hysteresis).
- Hard safety floor on the Pi side: failsafe at 80 °C and the kernel's 110 °C critical trip. The UI explains these but cannot change them.
- The frontend is static assets served by the backend; it must stay reasonably small and smooth on a desktop browser.
- The owner explicitly asked for a showpiece: striking visuals, motion and 3D. It must never read as a generic admin template.

## Brand Commitments

None beyond the brief: "a masterpiece", "nice aesthetics, cool animation and motions, 3D elements". No logo or name beyond the repo name `raspberrypi-dashboard` and the package name `pidash`.

## Evidence on Hand

- Real hardware facts: docs/PI_RECON.md (board, sensors, fan mechanism, measured RPM at each PWM).
- Payload examples and the mock-mode description: docs/API.md.
- No real screenshots of the running Pi yet; the frontend is built against a faithful in-browser mock of the documented payloads, labelled as demo data in the UI.

## Product Principles

1. Truth first: every number comes from the contract with its unit; unknown values show as "—", never as a guess.
2. Health at a glance, detail on demand: the worst state on the board is the loudest thing on the screen.
3. The hardware is the hero: the visuals depict this specific board and its real sensors, not abstract tech decoration.
4. Changing the fan is safe and reversible: the curve preview matches exactly what the Pi will do.

## Accessibility & Inclusion

WCAG AA contrast, full keyboard operation (including the curve editor), `prefers-reduced-motion` honoured, and a low-power mode that turns the 3D scene off.
