#!/usr/bin/env bash
# Install pidash on the Raspberry Pi, or update it: run it again after copying a newer checkout.
# Re-running keeps the config (and its token) and the saved fan profile.
#
#   sudo ./install.sh [--no-docker]
#
# Needs frontend/dist: build it first (cd frontend && npm ci && npm run build), on the Pi or on another computer
# (README.md -> Quick start).
# --no-docker: leave the service user out of the root-equivalent docker group (the Containers panel
# then says "unavailable"). Undo everything with: sudo ./uninstall.sh
set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)
APP=/opt/pidash
CONF=/etc/pidash/pidash.env
PORT=8787
docker=1
for a in "$@"; do
  case $a in
    --no-docker) docker=0 ;;
    *) echo "usage: sudo $0 [--no-docker]" >&2; exit 2 ;;
  esac
done
die() { echo "install.sh: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run it as root: sudo $0"
[ -f "$SRC/frontend/dist/index.html" ] || die "frontend/dist is missing: build it first (cd frontend && npm ci && npm run build) and copy it here"
umask 022

# A running service is stopped first so its venv is never half-built. Stopping hands the fan back to the
# kernel's config.txt curve; the restart at the end takes it again with the saved profile.
systemctl stop pidash 2>/dev/null || true

echo "==> service user pidash"
groups=video  # vcgencmd: throttling, power rails, PMIC temperature
# systemd-journal: read the journal, for the service logs in the dashboard (read-only)
if getent group systemd-journal >/dev/null; then groups=$groups,systemd-journal; fi
if [ "$docker" = 1 ] && getent group docker >/dev/null; then groups=$groups,docker; fi
if id pidash >/dev/null 2>&1; then
  usermod -G "$groups" pidash
else
  useradd --system --user-group --groups "$groups" --home-dir /nonexistent --no-create-home \
    --shell /usr/sbin/nologin pidash
fi

echo "==> app in $APP"
install -d -m 0755 "$APP"
python3 -m venv --clear --system-site-packages "$APP/venv" ||
  die "could not create the venv (on Debian: sudo apt install python3-venv)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r "$SRC/backend/pyproject.toml" "$SRC/backend/pidash" "$tmp/" # build a copy: no root-owned build/ in $SRC
# No pip cache left behind (the env var also reaches pip's isolated build step).
PIP_NO_CACHE_DIR=1 "$APP/venv/bin/pip" install --quiet --disable-pip-version-check "$tmp"
rm -rf "$APP/frontend"
install -d -m 0755 "$APP/frontend"
cp -r "$SRC/frontend/dist" "$APP/frontend/dist"
chmod -R a+rX "$APP"

echo "==> config $CONF"
install -d -m 0750 -g pidash /etc/pidash
token=
if [ ! -f "$CONF" ]; then
  token=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  umask 077
  cat >"$CONF" <<EOF
# pidash settings (docs/API.md -> Configuration). Apply changes with: sudo systemctl restart pidash
# One setting per line, nothing after the value: systemd would read a trailing comment as part of it.
PIDASH_TOKEN=$token
PIDASH_HOST=127.0.0.1
PIDASH_PORT=$PORT
# Read-only fan (the kernel's config.txt curve keeps it):
# PIDASH_FAN_CONTROL=0
# No web console (a shell as the pidash user for whoever has the token):
# PIDASH_CONSOLE=0
EOF
  umask 022
else
  echo "    kept, with its token"
  # Files from before 0.2.0 have "# PIDASH_FAN_CONTROL=0   # read-only: ...". Uncommented, systemd would read the
  # trailing comment as part of the value and fan control would stay on. Split it as the template above does.
  sed -i "s/^\(# \)\?PIDASH_FAN_CONTROL=0 .*/# Read-only fan (the kernel's config.txt curve keeps it):\n\1PIDASH_FAN_CONTROL=0/" "$CONF"
fi
chgrp pidash "$CONF"
chmod 0640 "$CONF"

echo "==> fan access: udev rule"
install -m 0644 "$SRC/deploy/90-pidash-fan.rules" /etc/udev/rules.d/90-pidash-fan.rules
udevadm control --reload
udevadm trigger --action=change --settle /sys/class/hwmon/hwmon* /sys/class/thermal/thermal_zone*

echo "==> system actions: sudoers drop-in and the update unit"
# Reboot, shutdown, system update and service restart from the dashboard (docs/API.md -> System actions).
# visudo checks the drop-in before it goes live: a broken file in /etc/sudoers.d breaks sudo for everyone.
install -m 0755 "$SRC/deploy/pidash-update" "$APP/pidash-update"
install -m 0644 "$SRC/deploy/pidash-update.service" /etc/systemd/system/pidash-update.service
install -m 0440 "$SRC/deploy/pidash.sudoers" "$tmp/pidash.sudoers"
visudo -cqf "$tmp/pidash.sudoers" || die "deploy/pidash.sudoers failed visudo's check (needs sudo >= 1.9.10)"
mv "$tmp/pidash.sudoers" /etc/sudoers.d/pidash

echo "==> systemd unit"
install -m 0644 "$SRC/deploy/pidash.service" /etc/systemd/system/pidash.service
systemctl daemon-reload
systemctl enable --quiet pidash
# Type=notify: this returns once the port is bound, or fails.
systemctl restart pidash || die "pidash did not start; see: journalctl -u pidash -n 50"

echo "==> tailnet: tailscale serve"
# The tailnet's port 8787 forwards to the port pidash listens on: PIDASH_PORT exactly as systemd passed it (8787 unless
# changed in the config). Read from the running service, so quoting or spacing in the file can't mislead it.
app_port=$(tr '\0' '\n' 2>/dev/null </proc/"$(systemctl show -p MainPID --value pidash)"/environ |
  sed -n 's/^PIDASH_PORT=//p' || true)
app_port=${app_port:-$PORT}
if command -v tailscale >/dev/null; then
  # Plain HTTP on the tailnet only. Persists across reboots. Never use `tailscale funnel` here.
  tailscale serve --bg --yes --http="$PORT" "http://127.0.0.1:$app_port" >/dev/null ||
    echo "    warning: tailscale serve failed; the dashboard only listens on 127.0.0.1:$app_port" >&2
  tailscale serve status || true # never skip the token below
else
  echo "    tailscale not found: the dashboard only listens on 127.0.0.1:$app_port (see README.md -> Without Tailscale)"
fi

echo
echo "pidash is running (systemctl status pidash)."
if [ -n "$token" ]; then
  echo
  echo "Auth token, needed to change the fan, reboot, shut down, update, restart services, read service logs and"
  echo "open the console from the dashboard."
  echo "It is shown only this once:"
  echo
  echo "    $token"
  echo
  echo "To see it again later: sudo grep TOKEN $CONF"
fi
