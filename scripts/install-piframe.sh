#!/usr/bin/env bash
# Install PiFrame on a freshly updated 64-bit Raspberry Pi OS desktop image.
# Run as the piframe user after completing README steps 1-4.
set -euo pipefail

readonly PIFRAME_USER="piframe"
readonly PIFRAME_REPOSITORY="https://github.com/jpasqua/PiFrame.git"
readonly PIFRAME_DIRECTORY="/opt/piframe"
# Prefix shell variables that could otherwise collide with programs sourced by
# this installer. In particular, nvm manages its own NVM_VERSION variable.
readonly PIFRAME_NVM_RELEASE="v0.40.6"
readonly PIFRAME_WIFI_CONNECT_RELEASE="v4.11.84"
readonly PIFRAME_WIFI_CONNECT_BINARY_SHA256="413d70e6d1c1366cbe2b32555e8476f3e92878178ed1b9c82205985f055f1936"
readonly PIFRAME_WIFI_CONNECT_UI_SHA256="e57a3cec559729516decf892beb1e7f191b23e71b2e13bcd43d36b980034ffbe"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ "$(id -un)" == "$PIFRAME_USER" ]] || fail "Run this script as $PIFRAME_USER, not $(id -un)."
[[ "$(uname -m)" == "aarch64" ]] || fail "This installer requires 64-bit Raspberry Pi OS (aarch64)."
[[ ! -e "$PIFRAME_DIRECTORY" ]] || fail "$PIFRAME_DIRECTORY already exists; use /opt/piframe/scripts/update-piframe.sh instead."

for command in curl git tar sha256sum; do
  command -v "$command" >/dev/null || fail "$command is required; install the Raspberry Pi OS prerequisites first."
done

# Authenticate sudo before the longer download and build steps.
sudo -v

NVM_DIR="$HOME/.nvm"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "Installing nvm $PIFRAME_NVM_RELEASE..."
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$PIFRAME_NVM_RELEASE/install.sh" | bash
fi

# shellcheck disable=SC1090
source "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
nvm use 22

NODE_PATH="$(command -v node)"
PIFRAME_UID="$(id -u "$PIFRAME_USER")"
echo "Using Node $(node --version) at $NODE_PATH"

echo "Cloning PiFrame..."
sudo git clone "$PIFRAME_REPOSITORY" "$PIFRAME_DIRECTORY"
sudo chown -R "$PIFRAME_USER:$PIFRAME_USER" "$PIFRAME_DIRECTORY"

cd "$PIFRAME_DIRECTORY"
npm ci
npm run check
npm run build

echo "Installing PiFrame service and kiosk files..."
sudo install -D -m 0644 \
  deploy/systemd/piframe.service.example \
  /etc/systemd/system/piframe.service
sudo sed -i "s|^User=.*|User=$PIFRAME_USER|" /etc/systemd/system/piframe.service
sudo sed -i "s|^Environment=PIFRAME_HOST=.*|Environment=PIFRAME_HOST=0.0.0.0|" \
  /etc/systemd/system/piframe.service
sudo sed -i "s|^ExecStart=.*|ExecStart=$NODE_PATH $PIFRAME_DIRECTORY/dist/server.js|" \
  /etc/systemd/system/piframe.service
sudo sed -i '/^Environment=PIFRAME_WAYLAND_DISPLAY=/d; /^Environment=PIFRAME_WAYLAND_RUNTIME_DIR=/d' \
  /etc/systemd/system/piframe.service
sudo sed -i \
  "/^Environment=PIFRAME_PLATFORM=/a Environment=PIFRAME_WAYLAND_RUNTIME_DIR=/run/user/$PIFRAME_UID" \
  /etc/systemd/system/piframe.service

sudo install -D -o root -g root -m 0755 \
  deploy/system/piframe-kiosk /usr/local/sbin/piframe-kiosk
sudo install -D -o root -g root -m 0644 \
  deploy/kiosk/kiosk-connecting.html /usr/local/share/piframe/kiosk-connecting.html
install -D -m 0644 \
  deploy/autostart/piframe-kiosk.desktop.example \
  "$HOME/.config/autostart/piframe-kiosk.desktop"

sudo install -D -o root -g root -m 0755 \
  deploy/system/piframe-system-action /usr/local/sbin/piframe-system-action
sudo install -D -o root -g root -m 0440 \
  deploy/sudoers/piframe-system-action /etc/sudoers.d/piframe-system-action
sudo visudo -cf /etc/sudoers.d/piframe-system-action

WIFI_CONNECT_TEMP="$(mktemp -d)"
WIFI_CONNECT_ARCHIVE="$WIFI_CONNECT_TEMP/wifi-connect-aarch64-unknown-linux-gnu.tar.gz"
WIFI_CONNECT_UI_ARCHIVE="$WIFI_CONNECT_TEMP/wifi-connect-ui.tar.gz"
cleanup() { rm -rf "$WIFI_CONNECT_TEMP"; }
trap cleanup EXIT

echo "Downloading WiFi Connect $PIFRAME_WIFI_CONNECT_RELEASE..."
curl -fsSL -o "$WIFI_CONNECT_ARCHIVE" \
  "https://github.com/balena-os/wifi-connect/releases/download/$PIFRAME_WIFI_CONNECT_RELEASE/wifi-connect-aarch64-unknown-linux-gnu.tar.gz"
echo "$PIFRAME_WIFI_CONNECT_BINARY_SHA256  $WIFI_CONNECT_ARCHIVE" | sha256sum -c -
curl -fsSL -o "$WIFI_CONNECT_UI_ARCHIVE" \
  "https://github.com/balena-os/wifi-connect/releases/download/$PIFRAME_WIFI_CONNECT_RELEASE/wifi-connect-ui.tar.gz"
echo "$PIFRAME_WIFI_CONNECT_UI_SHA256  $WIFI_CONNECT_UI_ARCHIVE" | sha256sum -c -

tar -xzf "$WIFI_CONNECT_ARCHIVE" -C "$WIFI_CONNECT_TEMP"
[[ -f "$WIFI_CONNECT_TEMP/wifi-connect" ]] || fail "WiFi Connect archive did not contain its binary."
sudo install -D -o root -g root -m 0755 \
  "$WIFI_CONNECT_TEMP/wifi-connect" /usr/local/sbin/wifi-connect
sudo install -d -o root -g root -m 0755 /usr/local/share/wifi-connect/ui
sudo tar -xzf "$WIFI_CONNECT_UI_ARCHIVE" -C /usr/local/share/wifi-connect/ui

sudo install -D -o root -g root -m 0755 \
  deploy/system/piframe-wifi-connect /usr/local/sbin/piframe-wifi-connect
sudo install -D -o root -g root -m 0644 \
  deploy/systemd/piframe-wifi-connect.service.example \
  /etc/systemd/system/piframe-wifi-connect.service

sudo systemctl daemon-reload
sudo install -d -m 0755 /var/lib/piframe
# Wi-Fi was configured through Raspberry Pi Imager, so do not force the initial
# setup portal on this developer installation.
sudo touch /var/lib/piframe/wifi-provisioned
sudo systemctl enable --now piframe-wifi-connect.service
sudo systemctl enable --now piframe.service

echo "Waiting for PiFrame to become healthy..."
for _ in {1..12}; do
  if curl -fsS http://127.0.0.1/health; then
    echo
    echo "PiFrame is installed. Reboot to verify Chromium kiosk startup: sudo reboot"
    exit 0
  fi
  sleep 5
done

echo "PiFrame did not become healthy within 60 seconds." >&2
echo "Inspect: sudo systemctl status piframe.service --no-pager -l" >&2
exit 1
