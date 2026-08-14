#!/usr/bin/env bash
# Developer test utility: join a Wi-Fi network manually, then return control to
# the normal PiFrame service dependency chain.
set -euo pipefail

read -r -p "Wi-Fi SSID: " ssid
if [[ -z "$ssid" ]]; then
  echo "An SSID is required." >&2
  exit 1
fi

read -r -s -p "Wi-Fi password: " password
printf '\n'
if [[ -z "$password" ]]; then
  echo "A Wi-Fi password is required." >&2
  exit 1
fi

sudo systemctl stop piframe-wifi-connect.service
sudo nmcli device wifi connect "$ssid" password "$password"
sudo systemctl start --no-block piframe.service

echo "Connected to $ssid. PiFrame will resume after its Wi-Fi dependency check."
