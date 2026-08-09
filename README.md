# PiFrame

PiFrame is a local-first digital picture frame built with Node.js, TypeScript, SQLite, and Sharp. It runs as a lightweight local web application: the owner workspace manages albums and display settings, while `/display` is the Chromium-kiosk-friendly slideshow view.

## Current Features

* SQLite-backed albums and managed photo storage
* Unified owner workspace with Dashboard, Frame, Presentation, Schedule, Albums, and System Status views
* Frame settings for identity, local description, location, time zone, language, and display orientation
* Assisted location setup using browser geolocation, place search, automatic time-zone resolution, and an editable advanced settings disclosure
* Album creation, renaming, and two-step deletion that removes contained photos and managed assets
* Album detail pages with a batch upload queue, Detail and Grid photo views, rotation, retry, and deletion actions
* Multi-file image upload for JPEG, PNG, WebP, GIF, TIFF, AVIF, and HEIF files up to 25 MB each
* Queue-side duplicate decisions using a three-option pill group: Keep both, Replace, or Skip
* Background generation of thumbnails and display derivatives; incomplete work resumes at startup and failed work can be retried
* Non-destructive rotation preserved as photo metadata and reflected in regenerated derivatives
* Full-screen slideshow with album selection, ordering, one- or three-photo layouts, fit/fill sizing, daily schedule, black-screen off mode, and optional clock overlay
* Local health endpoint, durable system events, and stale upload staging cleanup
* Pi deployment templates for a loopback-only systemd service and Chromium kiosk autostart

## Requirements

* Node.js 22 or newer
* npm 10 or newer
* Native build tooling supported by `better-sqlite3` and `sharp` when a prebuilt binary is not available

## Install

### Raspberry Pi developer setup

This path is for a developer setting up a Pi directly from GitHub. It is
separate from the offline USB provisioning path described in
[docs/PiImageBuild.md](docs/PiImageBuild.md).

Note: If you've run this process before and already have an Imdage to begin with, you can use it and skip to step 5.

1. Use Raspberry Pi Imager to write the full 64-bit Raspberry Pi OS desktop
   image. In its customisation settings, choose a hostname unique on the
   developer's network (for example `piframe-joe`), create the `piframe` user,
   set Wi-Fi country/locale/time zone, configure Wi-Fi, and optionally enable
   SSH.
2. Boot the Pi and log in as `piframe`.
3. Update the OS and install build/runtime prerequisites:

   ```bash
   sudo apt update
   sudo apt full-upgrade -y
   sudo apt install -y avahi-daemon build-essential curl git network-manager python3 wlr-randr
   ```

   Reboot after the OS upgrade, then log back in as `piframe`:

   ```bash
   sudo reboot now
   ```

4. [Optional] Save an image of the SD Card at this state. See below for the **Raspberry Pi SD Card: Backup & Restore Guide**

5. Install Node 22, then clone, build, and verify PiFrame. Run these commands
   as `piframe`, without `sudo`:

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
   source "$HOME/.bashrc"

   nvm install 22
   nvm alias default 22
   node --version
   npm --version
   ```
   

6. Install PiFrame

   ```bash
   sudo git clone https://github.com/jpasqua/PiFrame.git /opt/piframe
   sudo chown -R piframe:piframe /opt/piframe
   cd /opt/piframe
   npm ci
   npm run check
   npm run build
   ```

   `node --version` must report `v22` (or newer). The `nvm` installer and
   update instructions are maintained by the [official nvm
   project](https://github.com/nvm-sh/nvm#installing-and-updating).

7. Prepare the Wi-Fi Connect files on the host computer and copy the resulting
   `piframe-provision` directory to a USB flash drive. This download happens on
   the host, never on the Pi, and verifies the pinned official release assets:

   ```bash
   cd /path/to/PiFrame
   node scripts/prepare-wifi-connect-bundle.mjs /path/to/usb-root
   ```

   This developer path targets the 64-bit Raspberry Pi OS image. The script
   places the binary and portal UI under
   `piframe-provision/wifi-connect/` on the USB drive.

8. Install the service and kiosk autostart files. First obtain the absolute
   Node path and the `piframe` UID:

   ```bash
   NODE_PATH="$(command -v node)"
   PIFRAME_UID="$(id -u piframe)"
   printf '%s\n' "$NODE_PATH" "$PIFRAME_UID"
   ```

   Then install the templates and replace `ExecStart` with the Node path shown
   above. This is necessary because a systemd service does not load `nvm` from
   `.bashrc`:

   ```bash
   sudo install -D -m 0644 \
     /opt/piframe/deploy/systemd/piframe.service.example \
     /etc/systemd/system/piframe.service
   sudo sed -i "s|^User=.*|User=piframe|" \
     /etc/systemd/system/piframe.service
   sudo sed -i "s|^Environment=PIFRAME_HOST=.*|Environment=PIFRAME_HOST=0.0.0.0|" \
     /etc/systemd/system/piframe.service
   sudo sed -i "s|^ExecStart=.*|ExecStart=${NODE_PATH} /opt/piframe/dist/server.js|" \
     /etc/systemd/system/piframe.service
   sudo sed -i '/^Environment=PIFRAME_WAYLAND_DISPLAY=/d; /^Environment=PIFRAME_WAYLAND_RUNTIME_DIR=/d' \
     /etc/systemd/system/piframe.service
   sudo sed -i \
     "/^Environment=PIFRAME_PLATFORM=/a Environment=PIFRAME_WAYLAND_RUNTIME_DIR=/run/user/${PIFRAME_UID}" \
     /etc/systemd/system/piframe.service

   sudo install -D -o root -g root -m 0755 \
     /opt/piframe/deploy/system/piframe-kiosk \
     /usr/local/sbin/piframe-kiosk
   sudo install -D -o root -g root -m 0644 \
     /opt/piframe/deploy/kiosk/kiosk-connecting.html \
     /usr/local/share/piframe/kiosk-connecting.html

   install -D -m 0644 \
     /opt/piframe/deploy/autostart/piframe-kiosk.desktop.example \
     "$HOME/.config/autostart/piframe-kiosk.desktop"

   sudo install -D -o root -g root -m 0755 \
     /opt/piframe/deploy/system/piframe-system-action \
     /usr/local/sbin/piframe-system-action
   sudo install -D -o root -g root -m 0440 \
     /opt/piframe/deploy/sudoers/piframe-system-action \
     /etc/sudoers.d/piframe-system-action
   sudo visudo -cf /etc/sudoers.d/piframe-system-action

   # Adjust this to the USB drive's actual mount point.
   PIFRAME_USB=/media/piframe/<USB_LABEL>
   PIFRAME_WIFI_BUNDLE="$PIFRAME_USB/piframe-provision/wifi-connect"
   PIFRAME_WIFI_TEMP="$(mktemp -d)"
   tar -xzf "$PIFRAME_WIFI_BUNDLE/wifi-connect-aarch64-unknown-linux-gnu.tar.gz" \
     -C "$PIFRAME_WIFI_TEMP"
   sudo install -D -o root -g root -m 0755 \
     "$PIFRAME_WIFI_TEMP/wifi-connect" /usr/local/sbin/wifi-connect
   sudo install -d -o root -g root -m 0755 /usr/local/share/wifi-connect/ui
   sudo tar -xzf "$PIFRAME_WIFI_BUNDLE/wifi-connect-ui.tar.gz" \
     -C /usr/local/share/wifi-connect/ui
   rm -rf "$PIFRAME_WIFI_TEMP"

   sudo install -D -o root -g root -m 0755 \
     /opt/piframe/deploy/system/piframe-wifi-connect \
     /usr/local/sbin/piframe-wifi-connect
   sudo install -D -o root -g root -m 0644 \
     /opt/piframe/deploy/systemd/piframe-wifi-connect.service.example \
     /etc/systemd/system/piframe-wifi-connect.service

   sudo systemctl daemon-reload
   sudo install -d -m 0755 /var/lib/piframe
   sudo touch /var/lib/piframe/wifi-provisioned
   sudo systemctl enable --now piframe-wifi-connect.service
   sudo systemctl enable --now piframe.service
   sleep 5
   curl -fsS http://127.0.0.1/health
   ```

   The developer setup deliberately listens on the local network, so the owner
   workspace can be opened from another trusted machine at
   `http://<pi-hostname>.local`. PiFrame does not yet authenticate owner
   access, so leave this setting enabled only on a trusted development network.

   PiFrame automatically discovers the active `wayland-*` socket and a single
   HDMI output. Set `PIFRAME_WAYLAND_DISPLAY` or
   `PIFRAME_DISPLAY_CONNECTOR` only to override discovery for an unusual
   desktop configuration, such as more than one attached HDMI display.
   Reboot to verify kiosk startup:

   ```bash
   sudo reboot
   ```

   With Raspberry Pi OS configured for graphical autologin as `piframe`, the
   HDMI screen should automatically leave the desktop and show Chromium
   full-screen. While PiFrame is starting or Wi-Fi setup is needed, it first
   shows a local instruction screen; it automatically switches to `/display`
   once the service is healthy. The kiosk launcher uses a dedicated Chromium
   profile and Chromium's basic password store so graphical autologin does not
   trigger a desktop keyring dialog. If the desktop remains visible, inspect
   `piframe.service` and confirm that
   `~/.config/autostart/piframe-kiosk.desktop` belongs to `piframe`.

### Wi-Fi setup and recovery

PiFrame delegates Wi-Fi setup to [balena WiFi Connect](https://github.com/balena-os/wifi-connect).
It uses NetworkManager, creates an open temporary access point, presents a
mobile captive portal automatically, scans and lists nearby networks, and saves
the selected credentials after a successful connection.

`piframe-wifi-connect.service` owns only the appliance policy: a fresh frame
starts WiFi Connect immediately; a previously provisioned frame gives saved
connections up to 60 seconds to finish NetworkManager startup before it checks
for an active Wi-Fi association and starts WiFi Connect only if none exists. The
`/var/lib/piframe/wifi-provisioned` marker distinguishes those cases. The
developer installation above creates the marker because Wi-Fi was already
configured in Raspberry Pi Imager. The offline provisioning bundle supplies a
pinned WiFi Connect binary and UI so the Pi never needs Internet access to
enter setup mode.

### Migrating from the experimental portal

The original experimental `piframe-network.service` is incompatible with WiFi
Connect and must be removed when updating an existing frame. First ensure the
frame is connected to its normal network, then install the WiFi Connect bundle
and run the following once:

```bash
cd /opt/piframe
git pull --ff-only
npm ci
npm run build

sudo systemctl disable --now piframe-network.service || true
sudo rm -f /etc/systemd/system/piframe-network.service /usr/local/sbin/piframe-network-manager
sudo rm -f /etc/systemd/system/piframe.service.d/network.conf
sudo install -D -o root -g root -m 0644 \
  /opt/piframe/deploy/systemd/piframe-wifi-connect-dependency.conf.example \
  /etc/systemd/system/piframe.service.d/wifi-connect.conf

# Repeat the WiFi Connect binary/UI and service installation commands from step 8.
sudo systemctl daemon-reload
sudo touch /var/lib/piframe/wifi-provisioned
sudo systemctl enable piframe-wifi-connect.service
sudo systemctl restart piframe.service
```

The marker preserves normal boot behavior on an already connected developer
frame. To deliberately test recovery later, remove it and reboot:

```bash
sudo rm -f /var/lib/piframe/wifi-provisioned
sudo reboot
```

### Update an installed PiFrame

After changes have been pushed to GitHub, run the included helper on the Pi:

```bash
/opt/piframe/update-piframe.sh
```

It shows the working-tree status, fast-forwards from GitHub, installs the
locked dependencies, builds PiFrame, and restarts the service. It may prompt
for the `piframe` user's sudo password when restarting the service.


## Build, Run, and Test

### Development

```bash
npm run dev
```

For automatic restart while editing source files:

```bash
npm run dev:watch
```

Open the owner workspace at [http://127.0.0.1:3040](http://127.0.0.1:3040). Open the frame view at [http://127.0.0.1:3040/display](http://127.0.0.1:3040/display).

Desktop development uses `127.0.0.1`, port `3040`, and the local `./data` directory by default. The Raspberry Pi service uses port `80`, so an owner can open `http://<pi-hostname>.local` without a port suffix. It intentionally does not bind to `0.0.0.0` outside the Pi deployment setup.

Useful environment variables:

* `PIFRAME_HOST` defaults to `127.0.0.1`
* `PIFRAME_PORT` defaults to `3040` for desktop mode and `80` for Raspberry Pi mode
* `PIFRAME_DATA_ROOT` defaults to `./data`
* `PIFRAME_PLATFORM` accepts `desktop` or `raspberry-pi`
* `PIFRAME_DISPLAY_CONNECTOR` optionally overrides automatic HDMI-output discovery
* `PIFRAME_WAYLAND_DISPLAY` optionally overrides automatic Wayland socket discovery
* `PIFRAME_WAYLAND_RUNTIME_DIR` defaults to the current user's Wayland runtime directory

Example:

```bash
PIFRAME_HOST=127.0.0.1 PIFRAME_PORT=3040 npm run dev:watch
```

### Production Build

```bash
npm run build
npm start
```

`npm run build` writes compiled JavaScript to `dist/`; `npm start` runs that output.

### Verification

```bash
npm run check
npm run build
```

`npm run check` performs a TypeScript typecheck without writing output. There is not yet an automated test suite, so also perform these manual smoke checks:

* Open `/health`, `/`, and `/display`.
* Create, rename, and delete a test album.
* Upload several supported images to an album and confirm each reaches `ready`.
* Add an already-used filename to the queue; select Keep both, Replace, or Skip before uploading.
* Rotate a ready photo and confirm both its thumbnail and slideshow image update.
* Toggle the schedule or force-off setting and confirm `/display` becomes black.
* Save Frame settings, including a location search or browser-location lookup, and confirm the selected time zone persists after reload.

## Location Lookup

Frame settings keeps location editable while providing two optional, user-initiated helpers:

* **Use this device's location** asks the browser for coordinates, resolves a nearby city/region/country, and suggests the matching IANA time zone.
* **Search location** finds matching places from typed city, region, country, or postal-code text. Select a result before saving.

No location lookup occurs automatically. Text search and time-zone resolution use [Open-Meteo](https://open-meteo.com/); reverse geocoding uses [Nominatim](https://nominatim.org/) with [OpenStreetMap contributor](https://www.openstreetmap.org/copyright) attribution. Reverse lookups are cached in memory and serialized to respect the public Nominatim service's request limit. Language is currently fixed to English (United States) until the interface is translated.

## Storage and Processing

PiFrame creates its managed data directory on first start:

```text
data/
  app.db
  originals/
  derived/
    thumbnails/
    display/
    blurred/
  logs/
  tmp/
```

Original uploads are retained separately from generated assets. Generated thumbnails and display images are rebuildable. The `tmp/` directory is used to stage streamed uploads; stale staged files are periodically cleaned up.

## Raspberry Pi runtime notes

The developer setup above installs
`deploy/systemd/piframe.service.example` and
`deploy/autostart/piframe-kiosk.desktop.example`. It changes the template's
default loopback binding to LAN access for trusted developer testing; Chromium
remains the local kiosk client.

When `PIFRAME_PLATFORM=raspberry-pi`, PiFrame reconciles the saved schedule
every five seconds and controls the configured Wayland HDMI connector with
`wlr-randr`. It runs `--off` when the schedule turns off and `--on` when it
turns on; it does not repeatedly invoke the command while the desired state is
unchanged. The service must run as the same `piframe` desktop user that owns
the Wayland session. PiFrame derives that user's runtime directory as
`/run/user/<UID>` by default; set `PIFRAME_WAYLAND_RUNTIME_DIR` only if the OS
image uses a different location.

## Project Layout

* `src/config.ts` loads configuration and creates managed directories.
* `src/data/` owns SQLite migrations and repositories.
* `src/core/` contains validation and display/schedule defaults.
* `src/services/` handles ingestion, derivative generation, and recovery work.
* `src/web/app.ts` is the small top-level route dispatcher; `src/web/routes/`, `src/web/views/`, `src/web/http/`, and `src/web/static/` separate endpoint behavior, rendering, HTTP helpers, and browser assets.
* `docs/technical-design.md` describes the architecture and deployment direction.

## Tasks

The first five high-priority code-review findings have been addressed: streamed uploads, recoverable processing failures, staged-upload cleanup, safer upload error handling, and splitting the web application into route, view, shared HTTP, and static asset modules. Remaining review follow-ups are:

* Add automated unit and integration coverage for repositories, upload/duplicate decisions, image processing failures and retries, rotation, and slideshow selection.
* Add a reconciliation routine for the database and managed filesystem so interrupted file/database operations can be detected and repaired safely.
* Define an authentication and authorization model before enabling non-loopback administration access. Current origin checks help prevent cross-origin form submissions but are not user authentication.
* Add an operational backup and restore procedure for `data/app.db` and original uploads, including a documented upgrade/migration path.
* Complete Raspberry Pi operational work: installer guidance, kiosk recovery, true HDMI standby, and device-level diagnostics.

## Current Routes

* `/health`
* `/` - owner workspace
* `/admin/folders/:folderId/photos` - album detail
* `/display` - kiosk slideshow
* `/api/display/next` - slideshow photo selection API
* `/media/thumbnail/:photoId.jpg`
* `/media/display/:photoId.jpg`

## Raspberry Pi SD Card: Backup & Restore Guide (Mac)

This section documents the specific workflow for creating a compressed command-line backup of your Raspberry Pi SD card and restoring it using the graphical Raspberry Pi Imager. 

---

### Part 1: Creating a Compressed Backup (Terminal)

This process clones your entire SD card into a single file and compresses it to save disk space on your Mac.

#### Step 1: Identify the SD Card
1. Plug your SD card into your Mac.
2. Open the **Terminal** app.
3. Run the following command to list all connected drives:
   ```bash
   diskutil list
   ```
4. Look through the output to find your SD card by matching its capacity (e.g., 16 GB or 32 GB).
5. Note its identifier (e.g., `disk4` or `disk5`). 
   * **CRITICAL:** Do not confuse it with `disk0` or `disk1`, which are your Mac's internal hard drives.

#### Step 2: Unmount the Drive
Before making a clone, you must release the drive from the macOS operating system. Replace `N` with your specific disk number:
```bash
diskutil unmountDisk /dev/diskN
```

#### Step 3: Clone the Card to an Image File
Run the `dd` command to create an exact copy on your Desktop. 
* *Note: Adding an `r` in front of the disk name (e.g., `rdiskN`) dramatically speeds up the copy process.*

```bash
sudo dd if=/dev/rdiskN of=~/Desktop/piframe_backup.img bs=1m
```
1. Type your Mac login password when prompted and press **Enter** (no characters will show on screen).
2. The terminal will appear frozen. This is completely normal. The cloning process takes several minutes depending on the card speed.

### Step 4: Maximize Space Savings (Compression)
Because `dd` copies every single byte—including blank space—the resulting `.img` file will be massive. Run this command to compress it into a much smaller archive:
```bash
gzip -9 ~/Desktop/pi_backup.img
```
This leaves you with a compact `piframe_backup.img.gz` file on your Desktop and automatically cleans up the large, uncompressed original.

---

### Part 2: Restoring the Backup (Raspberry Pi Imager)

When you need to restore your backup to a new or formatted SD card, use the official graphical tool.

1. **Open** the **Raspberry Pi Imager** application on your Mac.
2. Click **Choose OS**, scroll all the way to the bottom of the list, and select **Use custom**.
3. **Select your backup file** (`piframe_backup.img.gz`) from your Desktop. *(There is no need to extract it first; the Imager handles compressed files directly).*
4. Click **Choose Storage** and select your target SD card.
5. Click **Write** and confirm the prompt to begin flashing the drive.
