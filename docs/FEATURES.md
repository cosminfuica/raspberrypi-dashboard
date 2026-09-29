# Extra features (task t_160063d5)

Three additions a Pi owner reaches for once the dashboard is their window into the Pi. Each one reuses what was
already there: the auth, the confirm dialog, the toasts, the System card and the Services table. None adds a
dependency or a background job.

## Shut down

**What.** A **Shut down…** pad in the System card, under Reboot. It asks first, like every action. The dialog says
plainly that nothing can turn the Pi back on over the network: you press its power button, or unplug it and plug it
back in. Once confirmed, the pads lock and the button reads "Shutting down…". A toast tells you when it's safe to
unplug: the power LED turns red.

**Why.** Before you move or unplug the Pi, a clean power-off stops the services and syncs the disk. Pulling the plug
on a running Pi can corrupt an SD card. Until now the only ways to do it were SSH or the console.

**How.** `POST /api/system/shutdown` → `systemctl poweroff`. It takes the same path as reboot: the token, a check
that sudo allows it, and it runs only after the response has gone out. It is refused while an update runs
(`409 update_running`). This makes the sudoers drop-in's fourth command (`deploy/pidash.sudoers`). In mock mode and
in the `?demo` page, the shutdown is only pretended.

## Service logs

**What.** A logs icon on every Services row, beside restart. It opens that service's journal in a wide dialog:

- the last 200 lines, newest at the bottom;
- **Follow** (on by default), which adds new lines as the service logs them;
- a filter for **All**, **Warnings** or **Errors**, each with its count;
- lines coloured by priority: errors in red, warnings in amber, debug faded.

It works for every listed unit, including those that can't be restarted.

**Why.** When a service shows **Failed**, the next question is always "why?". Now the answer is one tap away, not an
SSH session and a `journalctl -u` command.

**How.** `GET /api/services/{name}/logs?lines=N&after=<cursor>` runs `journalctl --output=json` for that one unit,
with no shell. The service user reads the journal through the `systemd-journal` group, which `install.sh` now adds.
It needs no root and no sudo.

- **It needs the token.** Logs can hold anything a service prints, so reading them is gated like the actions.
- **Following is a small poll** (every 2 s, 5–13 ms of journalctl on the Pi). It runs only while the dialog is open
  and the tab is visible. A cursor makes each poll fetch only new lines.
- **Degrades clearly.**
  - No journalctl: `503 journal_unavailable`.
  - The group is missing (not re-installed yet): 503, with "run install.sh again".
  - A unit not in the list: 404.

## Install it as an app

**What.** The page has a web app manifest and icons: an SVG, 192 and 512 px PNGs, a maskable one, and an Apple touch
icon. On a phone, open the dashboard and choose **Add to Home screen** (on iPhone: Share → Add to Home Screen). You
get a "pidash" icon on the home screen, and it opens without the browser's bars wherever the browser allows.

**Why.** It's the fastest way to check on the Pi from the sofa: one tap.

**How.** Static files in `frontend/public/` and three tags in `index.html`. There is no service worker: a live
dashboard has nothing useful to show offline.

- **Checked:** desktop Chromium reports it as installable, on localhost and on a plain-HTTP host name.
- **Not checked:** a physical phone.
- **A caveat:** Android's automatic install prompt may need HTTPS (README → Configuration → the optional
  `tailscale serve --https` step). Over plain HTTP, Add to Home screen still gives the icon and the name.

## Already there, so not added

The task's other ideas mostly exist already:

- Pi health: throttling flags, CPU clock, PMIC power rails, disks and filesystems.
- Network: per interface, with Wi-Fi signal and throughput.
- History: 10 minutes in every chart.
- Docker: the Containers panel.
- Health banner: the one-line verdict.

Possible follow-ups, not started: kill a process from the Processes table; alert notifications (ntfy or webhook); a
longer history than 10 minutes.

## For the README

- There are no new nav tabs or keys. Shut down is in the System card (key `=`). The logs icon is on each Services
  row (key `8`).
- Both need sign-in. The `?demo` page supports them with the token `demo`: its logs are made up, and the shutdown
  is pretended.
- Enabling them on an installed Pi needs `sudo ./install.sh` again. It adds the sudoers line and the
  `systemd-journal` group.
- The contract is in `docs/API.md` → System actions: `POST /api/system/shutdown` and
  `GET /api/services/{name}/logs`.
