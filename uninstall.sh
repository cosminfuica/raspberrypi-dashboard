#!/usr/bin/env bash
# Remove everything install.sh added: the service, the tailscale serve handler, the udev rule, the sudoers
# drop-in and the update unit, the app, the config (and its token), the saved fan profile, the audit log and
# the pidash user. The fan goes back to the kernel's config.txt curve. Safe to run more than once.
#
#   sudo ./uninstall.sh
set -euo pipefail

PORT=8787
[ "$(id -u)" -eq 0 ] || { echo "uninstall.sh: run it as root: sudo $0" >&2; exit 1; }

echo "==> service"
# Stopping hands the fan back to the kernel (pwm 255, trip points restored; it then spins down).
systemctl disable --now pidash 2>/dev/null || true
# A run that died without cleaning up leaves the kernel's fan curve switched off: hand it back (else a no-op).
if [ -x /opt/pidash/venv/bin/pidash ]; then /opt/pidash/venv/bin/pidash --restore-fan || true; fi
rm -f /etc/systemd/system/pidash.service
# The sudoers drop-in and the update unit. A running update finishes on its own: stopping it could break dpkg.
rm -f /etc/sudoers.d/pidash /etc/systemd/system/pidash-update.service /var/log/pidash-update.log
systemctl daemon-reload
systemctl reset-failed pidash pidash-update 2>/dev/null || true

echo "==> tailscale serve on :$PORT"
if command -v tailscale >/dev/null; then
  tailscale serve --http="$PORT" off >/dev/null 2>&1 || true # fails harmlessly when nothing is served there
fi

echo "==> fan access: udev rule and sysfs permissions"
rm -f /etc/udev/rules.d/90-pidash-fan.rules
udevadm control --reload
# The rule's chgrp/chmod outlive it until a reboot; undo them while the pidash group still exists.
for f in /sys/class/hwmon/hwmon*/pwm1 /sys/class/thermal/thermal_zone*/trip_point_[1-4]_temp; do
  if [ -e "$f" ] && [ "$(stat -c %G "$f")" = pidash ]; then
    chgrp root "$f"
    chmod g-w "$f"
  fi
done

echo "==> files and the pidash user"
rm -rf /opt/pidash /etc/pidash /var/lib/pidash
if id pidash >/dev/null 2>&1; then userdel pidash; fi
if getent group pidash >/dev/null; then groupdel pidash; fi

echo
echo "pidash is uninstalled."
