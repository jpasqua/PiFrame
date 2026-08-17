# PiFrame

PiFrame is a local-first digital picture frame built with Node.js, TypeScript, SQLite, and Sharp. It runs as a lightweight local web application: Administration manages albums and display settings, while `/display` is the Chromium-kiosk-friendly slideshow view.

## Current Features

* SQLite-backed albums and managed photo storage
* Unified Administration interface with Dashboard, Frame, Presentation, Schedule, Albums, System Status, and Help views
* Frame settings for identity, description, location, time zone, language, physical display orientation, and an Administration theme
* Three Administration themes: Neutral, Parchment, and Surf
* Assisted location setup using place search, automatic time-zone resolution, and an editable advanced settings disclosure
* Album creation, renaming, and two-step deletion that removes contained photos and managed assets
* Administration / Album Detail pages with a batch upload queue, Detail and Grid photo views, larger modal photo previews, rotation, retry, and deletion actions
* Multi-file image upload for JPEG, PNG, WebP, GIF, TIFF, AVIF, and HEIF files up to 25 MB each
* Queue-side duplicate decisions using a three-option pill group: Keep both, Replace, or Skip
* Background generation of thumbnails and display derivatives; incomplete work resumes at startup and failed work can be retried
* Non-destructive rotation preserved as photo metadata and reflected in regenerated derivatives
* Full-screen slideshow with album selection, ordering, adaptive one-, two-, or three-photo layouts, fit or Fill and Crop sizing, and slide transitions
* Optional clock and weather overlays; weather supports current conditions, a five-day forecast, and Imperial or Metric units
* Daily display schedule with immediate “Turn on frame now” and “Turn off frame now” overrides
* Local health endpoint, durable system events, and stale upload staging cleanup
* Pi deployment templates for a loopback-only systemd service and Chromium kiosk autostart

## Requirements

* Node.js 22 or newer
* npm 10 or newer
* Native build tooling supported by `better-sqlite3` and `sharp` when a prebuilt binary is not available

## Install

### Raspberry Pi developer setup

This path is for a developer setting up a Pi directly from GitHub.

Note: If you've created an image previously (step 4), then you can use it and skip to step 5.

1. Use Raspberry Pi Imager to write the full 64-bit Raspberry Pi OS desktop
   image. In its customization settings
   * Set the hostname to `piframe` or choose a unique name for the
   developer's network (e.g. `piframe-123`)
   * Create the `piframe` user
   * Set Wi-Fi country/locale/time zone
   * Configure Wi-Fi
   * Optionally enable SSH.
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

5. Download and run the PiFrame developer installer as `piframe`:

   ```bash
   curl -fsSL -o /tmp/install-piframe.sh \
     https://raw.githubusercontent.com/jpasqua/PiFrame/main/scripts/install-piframe.sh
   bash /tmp/install-piframe.sh
   ```

   The script installs Node 22, clones and builds PiFrame, installs the
   services and kiosk files, downloads and verifies the pinned WiFi Connect
   release, enables PiFrame, and checks the local health endpoint. It is for a
   new image and stops rather than overwriting an existing `/opt/piframe`.

   The developer setup deliberately listens on the local network, so the owner
   Administration can be opened from another trusted machine at
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
configured in Raspberry Pi Imager.

### Pi services and launch sequence

PiFrame relies on the following system-managed components. Only the two
`piframe-*.service` units are PiFrame systemd services; NetworkManager and
Avahi are Raspberry Pi OS services PiFrame uses.

```text
NetworkManager ──> piframe-wifi-connect.service ──> piframe.service
       │                                                  │
       │                                                  └── local HTTP app on port 80
       │
       └── saved Wi-Fi connection, or WiFi Connect portal

Graphical autologin ──> piframe-kiosk.desktop ──> piframe-kiosk
                                                    │
                                                    ├── local setup/status page
                                                    └── Chromium kiosk at /display once /health succeeds
```

* **`NetworkManager.service`** is provided by Raspberry Pi OS. It manages saved
  Wi-Fi profiles and the wireless adapter. PiFrame waits for it before making
  a connectivity decision.
* **`piframe-wifi-connect.service`** is a one-shot, boot-time gate that runs as
  root before the web app. Its `/usr/local/sbin/piframe-wifi-connect` wrapper
  immediately launches balena WiFi Connect for an unprovisioned frame. For an
  already provisioned frame it waits up to 60 seconds for NetworkManager to
  activate a saved connection; only if no Wi-Fi connection becomes active does
  it launch the open `PiFrame Setup-XXXX` captive portal. It remains active
  after completing so `piframe.service` can require it.
* **balena WiFi Connect** is started by that wrapper, not installed as a
  separate systemd unit. While it is needed it creates the setup access point,
  serves the captive portal, scans nearby networks, and saves the chosen
  NetworkManager connection. It exits after Wi-Fi connects successfully.
* **`piframe.service`** runs the Node application as user `piframe`. It
  requires and starts after `piframe-wifi-connect.service`, listens on port 80
  on a developer Pi, restarts automatically if the app exits, and serves both
  Administration and `/display`.
* **`piframe-kiosk.desktop`** is a user-session autostart entry rather than a
  system service. Graphical autologin starts `/usr/local/sbin/piframe-kiosk`.
  That launcher first opens a local, offline-safe instruction page in
  Chromium, polls PiFrame's loopback `/health` endpoint, then replaces the
  page with the full-screen `/display` view. This keeps Chromium from showing
  an error page during Wi-Fi setup or application startup.
* **`piframe-system-action`** is a small root-owned helper, invoked through a
  narrowly scoped sudoers rule when the System Status page requests restart or
  shutdown. It is not a long-running service.
* **`avahi-daemon.service`** is provided by Raspberry Pi OS and advertises the
  host as `<hostname>.local`; it is why an owner can normally open PiFrame
  without discovering the device IP address.

At boot, systemd first lets NetworkManager establish any saved Wi-Fi
connection, then completes the Wi-Fi gate, then starts the web app. Separately,
the graphical session launches the kiosk; the kiosk waits until the web app is
healthy before showing the frame. This means the service startup order is
reliable even when the desktop session becomes ready first.

#### Developer portal tests

These scripts intentionally remove and restore a developer Pi's Wi-Fi
connection. They are not part of the normal owner experience:

```bash
/opt/piframe/scripts/disconnect-wifi.sh
```

The disconnect script queues recovery before deleting the active Wi-Fi profile,
so it is safe to invoke over SSH even though that SSH session immediately ends.
It starts the `PiFrame Setup-XXXX` portal. To restore Wi-Fi manually from a
local terminal, use:

```bash
/opt/piframe/scripts/reconnect-wifi.sh
```

It prompts for the SSID and password, saves the connection through
NetworkManager, and starts PiFrame again.

### Update an installed PiFrame

After changes have been pushed to GitHub, run the included helper on the Pi:

```bash
/opt/piframe/scripts/update-piframe.sh
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

Open Administration at [http://127.0.0.1:3040](http://127.0.0.1:3040). Open the frame view at [http://127.0.0.1:3040/display](http://127.0.0.1:3040/display).

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
* Save Presentation settings and confirm the selected albums, layout, image sizing, transition, and overlays take effect on `/display`.
* Toggle the daily schedule, then use each immediate override and confirm `/display` becomes black or resumes.
* Save Frame settings, including a location search, and confirm the selected time zone persists after reload.
* Change the Administration theme in Frame, save it, and confirm it persists after a reload.

## Location Lookup

Frame settings keeps location editable while providing two optional, user-initiated helpers:

* **Search location** finds matching places from typed city, region, country, or postal-code text. Select a result before saving; this stores the coordinates used by the weather overlay and suggests the matching IANA time zone.

No location lookup occurs automatically. Text search and time-zone resolution use [Open-Meteo](https://open-meteo.com/). Language is currently fixed to English (United States) until the interface is translated.

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
* `src/web/app.ts` is the small top-level route dispatcher; `src/web/routes/`, `src/web/views/`, `src/web/http/`, and `src/web/static/` separate endpoint behavior, rendering, HTTP helpers, and browser assets. `src/web/views/workspace/` contains the individual Administration-panel renderers and shared page shell.
* `scripts/` contains installation, Wi-Fi recovery/testing, static-asset copying, and installed-frame update helpers.
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
* `/` - Administration
* `/admin/folders/:folderId/photos` - Administration / Album Detail
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
