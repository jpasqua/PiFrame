#!/usr/bin/env bash
# Developer test utility: remove the active Wi-Fi profile, then reboot into
# WiFi Connect recovery mode. It deliberately drops the current SSH session.
set -euo pipefail

uuid="$(
  nmcli -t -f UUID,TYPE,DEVICE connection show --active |
    awk -F: '$2 == "802-11-wireless" && $3 != "" && !uuid { uuid = $1 } END { if (uuid) print uuid }'
)"

if [[ -z "$uuid" ]]; then
  echo "No active Wi-Fi connection found." >&2
  exit 1
fi

echo "Scheduling Wi-Fi disconnect and reboot; the current Wi-Fi profile ($uuid) will be deleted."
echo "Your SSH connection will close. The Pi will reboot 10 seconds later."

# Queue the work before removing Wi-Fi so it proceeds after SSH disconnects.
sudo systemd-run \
  --unit=piframe-wifi-disconnect-reboot \
  --collect \
  --no-block \
  --on-active=2s \
  /bin/bash -c '
    set -euo pipefail
    nmcli connection delete uuid "$1"
    sleep 10
    systemctl reboot
  ' piframe-wifi-disconnect-reboot "$uuid"
