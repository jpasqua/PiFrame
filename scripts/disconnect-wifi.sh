#!/usr/bin/env bash
# Developer test utility: remove the active Wi-Fi profile and return the frame
# to WiFi Connect recovery mode. It deliberately drops the current SSH session.
set -euo pipefail

uuid="$(nmcli -t -f UUID,TYPE,DEVICE connection show --active | awk -F: '$2 == "wifi" && $3 != "" { print $1; exit }')"

if [[ -z "$uuid" ]]; then
  echo "No active Wi-Fi connection found." >&2
  exit 1
fi

echo "Scheduling Wi-Fi portal test; the current Wi-Fi profile ($uuid) will be deleted."
echo "Your SSH connection will close. Join PiFrame Setup-XXXX to continue testing."

# Queue the work before removing Wi-Fi so it proceeds even after SSH disconnects.
sudo systemd-run \
  --unit=piframe-wifi-portal-test \
  --collect \
  --no-block \
  --on-active=2s \
  /bin/bash -c '
    set -euo pipefail
    systemctl stop piframe.service
    nmcli connection delete uuid "$1"
    systemctl restart --no-block piframe-wifi-connect.service
    systemctl start --no-block piframe.service
  ' piframe-wifi-portal-test "$uuid"
