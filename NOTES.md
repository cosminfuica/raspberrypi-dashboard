# Notes: things that need your attention

Last updated by task t_cfb85788 (scaffold, Pi recon, API contract).

## Needs you

1. **Where the dashboard should listen on the Pi.** Pick one for the deploy task. Both are tailnet-only:
   - **Recommended:** the default `127.0.0.1`, published with `tailscale serve`.
     - HTTPS needs "HTTPS Certificates" turned on in the Tailscale admin console (DNS page). It is off today.
     - Without it, `tailscale serve` can still do plain HTTP.
   - Or bind the Tailscale IP directly: `PIDASH_HOST=100.106.106.35`. You would open `http://raspberrypi:8787`.

   Don't bind `0.0.0.0`: `wlan0` is on your home LAN and the Pi has no firewall.
2. **Docker panel = the `docker` group.** Showing containers means adding the dashboard's service user to the `docker` group, which is root-equivalent. The alternative is to leave the panel "unavailable". Your call at install time.
3. **SSH key (optional, convenience).** This desktop's key isn't in the Pi's `~/.ssh/authorized_keys`, so agents log in with the password. To switch to key login, run once: `ssh-copy-id cosmin@100.106.106.35`.

## Heads-up (no action needed)

- **Fan control and your config repo.** The dashboard changes the fan curve at runtime, without editing `config.txt` or rebooting (see docs/PI_RECON.md).
  - The `argon-neo5-fan` block in `config.txt` stays the boot default. It takes over whenever the dashboard isn't running.
  - The **Balanced** profile reproduces that curve, so installing the dashboard changes nothing until you pick another profile.
- **Your config repo has an outdated note.** `argon-neo5-fan/README.md` → Pitfalls says the trip points are read-only because `CONFIG_THERMAL_WRITABLE_TRIPS` is unset.
  - On this 6.18 kernel they are root-writable at runtime: that option no longer exists, and device-tree trips are always writable.
  - Details and kernel-source references are in docs/PI_RECON.md. Nothing was changed in that repo.
- **The Pi runs Debian 13 (trixie), not Bookworm.** Python is 3.13, there's no Node.js, and psutil 7.0 is available from apt. Everything targets that.
- **Recon side effect.** The recon ran a 60-second CPU load to watch the fan start. Nothing on the Pi was changed or installed.
