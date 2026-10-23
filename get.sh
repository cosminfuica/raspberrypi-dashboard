#!/usr/bin/env bash
# One-line install or update of pidash on the Raspberry Pi, from the latest GitHub Release:
#
#   curl -fsSL https://raw.githubusercontent.com/cosminfuica/raspberrypi-dashboard/main/get.sh | bash
#
# Flags go to install.sh: ... | bash -s -- --no-docker
# The release's pidash.tar.gz (.github/workflows/release.yml) carries a prebuilt frontend/dist, so the Pi needs no
# Node.js. Running it again updates to the newest release and keeps the token, settings and fan profile.
set -euo pipefail

# Everything runs from main, called on the last line: bash has read the whole script before any of it runs, so a cut-off
# download does nothing, and apt or sudo can't read the rest of the script from the pipe.
main() {
  local url=https://github.com/cosminfuica/raspberrypi-dashboard/releases/latest/download/pidash.tar.gz
  local sudo=
  [ "$(id -u)" -eq 0 ] || sudo=sudo # sudo asks for the password on the terminal, not on the pipe

  # install.sh builds a venv; Raspberry Pi OS Lite leaves out python3-venv.
  if ! dpkg-query -W -f='${db:Status-Abbrev}' python3-venv 2>/dev/null | grep -q '^ii'; then
    echo "==> apt install python3-venv"
    $sudo apt-get update -qq
    $sudo apt-get install -y -qq --no-install-recommends python3-venv
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  echo "==> download $url"
  curl -fsSL "$url" | tar -xz -C "$tmp"
  $sudo bash "$tmp/pidash/install.sh" "$@"
}

main "$@"
