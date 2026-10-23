# pidash

pidash is a live dashboard and fan controller for one Raspberry Pi 5, served by the Pi itself to the owner's devices on
their tailnet. These are the words it uses for the Pi, its fan, its health and the changes the owner can make.

## Language

### The Pi and its readings

**Pi**:
The one Raspberry Pi 5 that a pidash install runs on, reports on and controls.
_Avoid_: host, server, device, node, machine

**Reference Pi**:
The owner's own Pi 5 (8 GB, Argon NEO 5 case with a blower fan and an NVMe drive), which the Board depicts and every
hardware measurement came from.
_Avoid_: reference build, test Pi, cosmin-pi

**Reading**:
One value measured on the Pi, always with its unit. A reading that can't be taken is unknown and shows as "—", never
as a guess.
_Avoid_: metric, stat, sensor value

**Unavailable**:
A source this Pi can't read or pidash isn't allowed to use (no fan, no Docker access, no PMIC), said in words. It is
not the same as zero: "no containers" and "Docker unavailable" are different states.
_Avoid_: error, missing, broken

**History**:
The last 10 minutes of readings, one per second, kept on the Pi so charts start full when a page opens.
_Avoid_: log, buffer, ring

**SoC**:
The BCM2712 chip that holds the CPU cores and the GPU. Its temperature is the Control temperature.
_Avoid_: CPU (for the chip or its temperature)

**RP1**:
The Pi 5's own I/O chip, which also drives the fan and counts its turns. pidash reads its temperature.
_Avoid_: southbridge, I/O controller

**PMIC**:
The Pi 5's power-management chip, which measures the Rails and reports its own temperature.
_Avoid_: power chip, regulator

**Rail**:
One supply line the PMIC measures, with its voltage, current and power.
_Avoid_: channel, power line

**SoC power**:
The sum of all Rail powers. It leaves out what is fed straight from the 5 V input (USB devices, the NVMe drive), so it
is always below wall power.
_Avoid_: total power, wall power, Pi power

**Throttling**:
The firmware slowing the SoC to protect it: the CPU from 80 °C, the CPU and GPU from 85 °C. pidash reports it and
cannot change these limits.
_Avoid_: thermal limiting, slowdown

**Throttle flags**:
The firmware's four conditions (under-voltage, frequency capped, throttled, soft temperature limit), each reported as
"now" and "since boot".
_Avoid_: throttle state, throttle bits

**Under-voltage**:
The Pi's supply sagged below what a Pi 5 needs, which means the power supply is inadequate. The most serious Throttle
flag.
_Avoid_: brownout, low power, low voltage

### Fan control

**Fan profile**:
A named Fan curve the Owner picks: Silent, Balanced, Performance, Max or Custom.
_Avoid_: preset, mode, fan setting

**Builtin profile**:
One of the four fixed profiles: Silent, Balanced, Performance and Max. Balanced is the default, modelled on the
Reference Pi's Kernel curve.
_Avoid_: default profiles, stock profiles

**Custom profile**:
The one profile the Owner edits. It starts as a copy of Balanced, and saving it does not make it Active.
_Avoid_: user profile, my curve

**Active profile**:
The Owner's saved pick, kept across restarts.
_Avoid_: current profile, selected profile

**Applied profile**:
The profile driving the fan right now: the Active profile, or the Night profile while the Night schedule runs.
_Avoid_: current profile, running profile

**Fan curve**:
The Curve points and Hysteresis that turn the Control temperature into a Fan speed. Between points the speed follows a
straight line; before the first and after the last it stays flat.
_Avoid_: fan table, ramp, fan map

**Curve point**:
One temperature and speed pair on a Fan curve, in whole °C from 20 to 80 and whole percent. A curve has 2 to 8 points,
with temperatures rising and speeds never falling.
_Avoid_: node, step

**Hysteresis**:
How many °C a Fan curve lags when slowing down: the fan speeds up at once, but slows only when the SoC is that much
cooler. It keeps a jittery sensor from making the fan hunt.
_Avoid_: deadband, delay

**Control temperature**:
The SoC temperature, the one reading every Fan curve and the Failsafe act on.
_Avoid_: CPU temperature, fan temperature

**Fan speed**:
How hard the fan is driven, as a percent of full power. Fan curves are drawn in it; the fan's measured RPM follows it
with a lag.
_Avoid_: PWM, duty cycle, RPM

**Target speed**:
The Fan speed the Applied profile asks for at this second's Control temperature, after Hysteresis and the Stall guard.
_Avoid_: setpoint, requested speed

**Stall guard**:
The lowest speed the fan is driven at other than off: any Target speed between 0 and 8 % is raised to 8 %, so the fan
never sits powered but still. Fixed, not a setting.
_Avoid_: minimum speed, stall floor

**Failsafe**:
Full speed forced over any profile when the SoC reaches 80 °C or can't be read, held until it is below 75 °C. Fixed, not
a setting.
_Avoid_: emergency mode, override, max mode

**Fan mode**:
Who drives the fan now: Curve (pidash runs the Applied profile), Failsafe, or Kernel (the Kernel curve is in charge, and
profile picks are saved but not applied).
_Avoid_: fan state, fan status

**Kernel curve**:
The fan curve set in the Pi's `config.txt`, which the Linux kernel runs whenever pidash isn't driving the fan. pidash
never edits it.
_Avoid_: config.txt curve, firmware curve, default curve

**Hand-back**:
Returning the fan to the Kernel curve at full speed, so the kernel steps it down as the SoC allows. It happens whenever
pidash stops, crashes or hangs, and when it is uninstalled.
_Avoid_: release, restore, reset

**Critical trip**:
The kernel's emergency shutdown of the Pi at 110 °C. It stays armed under every profile and mode; pidash never touches
it.
_Avoid_: crit trip, thermal shutdown

**Night schedule**:
An optional daily window, in the Pi's local time and possibly across midnight, during which a chosen Night profile
replaces the Active profile. Off by default.
_Avoid_: quiet hours, night mode

**Night profile**:
The Fan profile the Night schedule applies inside its window, Silent unless the Owner picks another.
_Avoid_: quiet profile

**Tonight's pause**:
What a profile pick inside tonight's window causes: the pick applies at once and the Night schedule waits for its next
start. Saving the schedule again resumes it.
_Avoid_: skipped, skip, override

### Health

**Verdict**:
The one headline that says how the Pi is now: Healthy, "N to check", or "N problems". The worst Reason sets it.
_Avoid_: status, summary, health score

**Reason**:
One sentence under the Verdict about one thing pidash checked, with its Health level and a link to its Section and
Part.
_Avoid_: check, alert, issue

**Health level**:
How bad a Reason is: Healthy (green), To check (amber) or Problem (red). Green, amber and red LEDs on the page mean
Health levels and nothing else.
_Avoid_: ok/warn/bad, warning, error, critical

**No contact**:
The page has had no data from the Pi for 20 seconds, so the Verdict stops vouching for old readings and says so.
_Avoid_: offline, stale, down, disconnected

### Access and actions

**Owner**:
The person who installed pidash on their Pi and holds its Token.
_Avoid_: user, admin, operator

**pidash user**:
The unprivileged system account pidash runs as on the Pi. Console shells run as it too.
_Avoid_: service user, the user

**Tailnet**:
The Owner's Tailscale network, the only place pidash can be reached from: never the LAN or the public internet.
_Avoid_: VPN, the network

**Token**:
The one secret that allows Changes, reading logs, and the Console. `install.sh` prints it once, and changing it signs
every browser out.
_Avoid_: password, API key

**Sign-in**:
Trading the Token for a browser session that lasts 7 days. Looking at the Pi needs none.
_Avoid_: log in, login, authenticate

**Change**:
Anything that alters the Pi: a Fan profile pick, a Custom profile or Night schedule save, or a System action. Every Change
needs the Token and goes in the Audit log.
_Avoid_: mutation, write, command

**System action**:
A Change that needs root: reboot, shut down, a System update or a Service restart. Each one is a fixed command; nothing
from a request reaches root.
_Avoid_: chore, admin task

**System update**:
Upgrading the Pi's own packages with apt, one run at a time, with its log streamed to the page. The Pi can't be rebooted or
shut down while one runs. It does not update pidash itself.
_Avoid_: upgrade, apt update, pidash update

**Service**:
A systemd service on the Pi, as listed in the Services section with failed ones first. The Owner can restart one or read
its Service log.
_Avoid_: unit, daemon, app

**Service log**:
A Service's journal lines, oldest first, which the page can follow live. It needs the Token, because services may print
secrets.
_Avoid_: journal, logs

**Audit log**:
The record of every attempted Change and every Console session, refused ones included. It never holds request bodies,
tokens or keystrokes.
_Avoid_: history, activity log

**Console**:
A real bash shell on the Pi, as the pidash user, inside the page. A new connection is always a new shell.
_Avoid_: terminal, SSH, web shell

**Docker access**:
Whether the pidash user may use Docker, which is root-equivalent and so makes the Console root-equivalent too. The
Owner chooses it at install.
_Avoid_: docker mode

### The page

**Board**:
The drawing of the Pi on the page, in 3D or 2D, with each reading pinned to its Part. It always depicts the
Reference Pi.
_Avoid_: hero, stage, model, scene

**Part**:
A physical component that the Board shows and a reading belongs to: the SoC, RAM, RP1, PMIC, NVMe drive, fan or Wi-Fi.
_Avoid_: component, chip

**Callout**:
A label beside the Board, joined to its Part by a leader line, that carries the part's live reading and, when something
is wrong, its Reason.
_Avoid_: tooltip, annotation, tag

**2D board**:
The flat assembly drawing of the Board, shown when the Owner switches the 3D view off (which also stops continuous
motion) or when the browser has no WebGL. The Pi is unaffected.
_Avoid_: low-power mode, lite mode

**Section**:
One titled area of the page about one subject (Fan, Thermals, Services, System and so on), reached with the number-row
keys.
_Avoid_: card, panel, tile

### Made-up data

**Mock Pi**:
pidash's server serving made-up readings instead of a real Pi, so it can be built and tried on any computer. Changes
work but reach no hardware, and the Console is off by default.
_Avoid_: fake Pi, simulator, mock mode

**Demo**:
The page running entirely in the browser on made-up data, with no pidash server at all.
_Avoid_: mock, demo mode
