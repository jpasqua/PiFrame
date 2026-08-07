# PiFrame Raspberry Pi Deployment and First-Boot Provisioning

This document defines the intended path from a clean Raspberry Pi OS image to
a deployed PiFrame. It is an implementation plan, not an installation guide
for an already running development checkout.

## Goals

* Use the full Raspberry Pi OS desktop installation and its Wayland desktop.
* Provide a repeatable USB installation process for a Raspberry Pi OS card with
  the `piframe` user and hostname.
* Give every installed frame a simple, display-led Wi-Fi setup and recovery
  experience.
* Keep the application, provisioning services, and platform-specific scripts
  separate enough to test and update them independently.

## Terms and persistent state

The provisioning implementation owns a durable state record under
`/var/lib/piframe/`. At minimum it records whether initial provisioning has
completed successfully.

`initial setup mode`
: The provisioning-complete marker is absent. This is true for a newly flashed
  image and after an explicit factory/network reset.

`normal mode`
: The provisioning-complete marker is present. NetworkManager has one or more
  saved Wi-Fi connections and PiFrame can start normally once a connection is
  available.

The marker is written only after a user-supplied Wi-Fi connection is verified.
It must not be inferred from the current Wi-Fi signal or from whether the
machine has Internet access.

## Base operating system

### Base system

Start each device with the current full 64-bit Raspberry Pi OS desktop image,
created through Raspberry Pi Imager. Configure the base card with:

* Linux user: `piframe`.
* Initial hostname: `piframe`.
* Automatic graphical login for the kiosk user.
* The Wayland desktop, Chromium, and the PiFrame application runtime.
* Node.js 22, including native dependency build prerequisites needed by
  `better-sqlite3` and Sharp.
* NetworkManager, Avahi/mDNS, `wlr-randr`, and the display-power adapter.
* The PiFrame systemd service, kiosk launch service, and provisioning services.

PiFrame is installed from a checksummed USB provisioning bundle, not baked into
a resized operating-system image. The bundle contains all target-platform
software needed by the installer; the Pi has no Internet requirement during
installation. See [PiImageBuild.md](PiImageBuild.md) for the build runbook.

## First boot

`piframe-firstboot.service` runs before the normal PiFrame and kiosk services.
It initializes local provisioning state and identities required by the USB
installer. It has no network dependency and performs no partition expansion.

## Wi-Fi provisioning and recovery

Raspberry Pi OS uses NetworkManager as the authority for saved Wi-Fi
connections. PiFrame should not write ad-hoc `wpa_supplicant` configuration
files.

PiFrame uses NetworkManager directly to create a temporary access point,
collect a selected SSID and passphrase through its local setup page, save the
connection, and retry if joining fails. The `piframe-network.service` owns when
that component is started and stopped; it does not replace NetworkManager or
write `wpa_supplicant` configuration files.

### Initial setup flow

1. Boot and check the provisioning-complete marker.
2. If the marker is absent, enter initial setup mode immediately.
3. Start an open temporary AP named `PiFrame Setup-ABCD`, where `ABCD` is a
   stable short device identifier.
4. Display the SSID, an explicit setup URL, and a QR code on HDMI.
5. WiFi Connect collects the home-network credentials and asks NetworkManager
   to connect.
6. After a verified successful connection, stop the AP, retain the saved
   NetworkManager connection, write the provisioning-complete marker, and
   proceed to normal PiFrame startup.

### Normal boot and recovery flow

1. If the marker is present, do not start the AP immediately.
2. Let NetworkManager scan for and attempt saved connections for up to
   60 seconds.
3. If a saved connection succeeds, continue in normal mode without creating an
   AP.
4. If none succeeds, start the same temporary AP and show recovery instructions
   on the HDMI display.
5. Once the user supplies working credentials and the connection is verified,
   stop the AP and resume normal mode. The provisioning-complete marker stays
   present.

This lets a user recover from a changed home Wi-Fi password without SSH or
reflashing the SD card.

### Open-AP limitations and safeguards

The temporary AP is intentionally open to reduce user confusion. It is a
usability choice with a real security cost: credentials entered through a
normal HTTP captive portal can be observed by a nearby party.

Mitigations required in the implementation:

* The AP is active only during initial setup or connection recovery.
* AP clients receive no routed Internet access.
* Firewall AP clients away from PiFrame's normal application, SSH, file shares,
  and the wider LAN. They may reach only the setup portal and required DHCP/DNS
  services.
* The display clearly identifies the temporary nature of the network.
* The AP stops immediately after a verified successful connection.

If this risk becomes unacceptable, switch to a WPA2-protected AP or a
purpose-built encrypted pairing flow; do not silently expose the normal
administration UI on the temporary network.

## HDMI user experience

The user should never have to infer the device state from logs or LEDs. Before
the slideshow is available, Chromium displays a local provisioning/status page
with these states:

* **Preparing PiFrame** — initializing local setup services.
* **Starting Wi-Fi setup** — access point is being prepared.
* **Connect your phone** — show `PiFrame Setup-ABCD`, setup URL, and QR code.
* **Connecting to Wi-Fi** — identify the selected network without displaying
  its password.
* **Ready** — show the device's local address and the next action.
* **Could not connect** — say that the setup AP remains available and invite
  the user to try again.

Captive-portal auto-opening is helpful but inconsistent across phones. The
screen must always provide an explicit local URL, such as `http://192.168.4.1`,
in addition to a QR code.

## Reaching settings after setup

The intended user experience is to visit `http://piframe.local` after the
frame joins the home network. Today PiFrame intentionally binds its main HTTP
server to loopback, so this requires a deliberate platform feature; changing
the bind address to all interfaces without authentication is not acceptable.

Before enabling this experience, implement one of these controlled designs:

1. A paired provisioning gateway that exposes only setup/settings routes and
   requires a one-time code or QR token shown on the physical display.
2. Authentication for PiFrame administration, followed by an intentional LAN
   listener for the authenticated application.

Do not make the full unauthenticated PiFrame UI available to every device on a
home LAN merely to satisfy `.local` access. This is a required design decision
before the post-setup browser workflow is implemented.

The factory hostname remains `piframe`, producing `piframe.local` through
mDNS. If multiple PiFrames will coexist on one network, the build must add a
per-device hostname strategy (for example, `piframe-ABCD.local`) and show that
address on the Ready screen.

## Systemd ownership and ordering

The platform layer should use distinct services rather than embedding these
concerns in the Node.js server:

| Service | Responsibility |
| --- | --- |
| `piframe-firstboot.service` | One-time machine and provisioning-state initialization. |
| `piframe-network.service` | Tries saved Wi-Fi, starts the temporary AP when necessary, and supplies status to the setup screen. |
| `piframe.service` | Starts the local Node.js application. |
| `piframe-kiosk.service` | Starts Chromium in the Wayland session and displays either provisioning status or the frame. |
| display-power adapter | Invokes the approved `wlr-randr` HDMI control for schedule changes. |

`piframe.service` and `piframe-kiosk.service` must wait until the first-boot
service has completed. The provisioning status page must stay available if
PiFrame fails to start, so that a user sees a useful failure state rather than
a blank display.

## Implementation order

1. Create the USB-bundle build script and offline installer.
2. Add durable provisioning state and the HDMI status page.
3. Install and validate the NetworkManager portal script, then implement initial setup mode.
4. Implement normal-boot connection timeout and recovery AP mode.
5. Add AP firewall isolation and exercise failure/retry cases.
6. Decide and implement the authenticated/pairing path for browser access to
   settings at `piframe.local`.
7. Validate the full flow on Pi 4 and Pi 5 with an HDMI monitor: fresh card,
   bad Wi-Fi password, changed Wi-Fi password, no available network, and a
   successful recovery.

## Acceptance checks

* A USB bundle provisions a freshly imaged Pi without network access.
* A fresh device presents setup instructions without a keyboard, mouse, or
  SSH session.
* A previously configured device does not create an AP when its saved Wi-Fi
  works.
* A previously configured device offers recovery when saved Wi-Fi fails.
* The display communicates every provisioning state clearly.
* An AP client cannot reach PiFrame administration or the surrounding LAN.
* The release artifact contains no user Wi-Fi credentials, SSH keys, database,
  photos, or other site-specific data.
