# PiFrame USB Provisioning Plan

PiFrame will be provisioned on top of a normal, freshly imaged Raspberry Pi OS
card. We will not build or distribute a custom resized operating-system image.
Raspberry Pi Imager creates the full 64-bit Raspberry Pi OS desktop card and a
USB drive installs the PiFrame-specific software.

This is the future appliance-provisioning path. The direct developer workflow
is documented in the repository [README](../README.md).

## Intended operator flow

1. Use Raspberry Pi Imager to write full 64-bit Raspberry Pi OS to any suitable
   SD card, creating the `piframe` user.
2. Boot the Pi, insert a prepared USB provisioning drive, and run its installer
   as `piframe`.
3. The installer verifies and copies all required PiFrame software and service
   configuration from the USB drive. The Pi does not need an Internet
   connection during this process.
4. Remove the USB drive and shut the Pi down.
5. On its next boot, PiFrame starts its initial Wi-Fi setup flow and displays
   instructions on HDMI.

## USB bundle

The USB contains a dedicated `piframe-provision/` directory:

```text
piframe-provision/
  install-piframe.sh
  manifest.env
  checksums.sha256
  payload/
    piframe-source.tar.gz
    node/                         # pinned Node 22 Linux ARM64 runtime
    node_modules-linux-arm64.tar.gz
    apt-repository/               # required Raspberry Pi OS ARM64 packages
    wifi-connect/                 # pinned ARM64 artifact
    systemd/
    autostart/
    status-page/
```

The bundle is specific to the target: 64-bit Raspberry Pi OS and `aarch64`.
It must not contain macOS `node_modules`, PiFrame data, source-control metadata,
Wi-Fi credentials, user SSH keys, or personal browser state.

## USB creation

The future `tools/create-provisioning-usb.sh <mounted-volume>` command will:

1. Build and typecheck PiFrame from a known commit.
2. Export a clean source and built-static-assets archive.
3. Build production dependencies in a Linux/ARM64 environment and package
   them separately from host-platform dependencies.
4. Download a pinned Node 22 Linux/ARM64 runtime and WiFi Connect release.
5. Resolve any Raspberry Pi OS packages not included in full Pi OS, plus their
   dependencies, into a local APT repository on the USB drive.
6. Copy systemd, kiosk, status-page, and installer files.
7. Write a manifest and SHA-256 checksums for every payload file.

The script runs on the networked development computer. It may use Docker to
produce Linux/ARM64 dependencies. It must only replace the dedicated
`piframe-provision/` directory on an explicitly selected mounted USB drive.

## Installer responsibilities

`install-piframe.sh` must stop on the first error and perform these actions in
order:

1. Verify manifest, checksums, architecture, and expected Raspberry Pi OS
   release.
2. Install required OS packages only from the local USB APT repository.
3. Install the bundled Node runtime and target-platform production dependencies
   for the `piframe` user.
4. Install PiFrame under `/opt/piframe` and verify its built server and native
   dependencies.
5. Install the PiFrame systemd service, Chromium kiosk autostart file,
   first-boot/provisioning services, WiFi Connect, provisioning status page,
   and temporary-AP firewall rules.
6. Enable services for the next boot but do not start the provisioning access
   point on the installation boot.
7. Assert that no saved NetworkManager Wi-Fi profiles are present and remove
   any that were inadvertently introduced.
8. Ensure the provisioning-complete marker is absent.
9. Ask the operator to remove the USB drive and shut down.

## First boot after USB installation

With no provisioning-complete marker, the next normal boot starts the open
`PiFrame Setup-ABCD` access point and shows setup instructions on HDMI. When a
user supplies working Wi-Fi credentials, NetworkManager saves the connection,
the AP stops, and the marker is written.

Later boots try saved Wi-Fi networks for up to 60 seconds. If none connects,
the same setup AP appears again to recover from changed network credentials.

See [PiDeployment.md](PiDeployment.md) for the detailed service ordering,
temporary-AP restrictions, visual states, and browser-administration security
boundary.

## Required implementation work

* `tools/create-provisioning-usb.sh`
* `deploy/provision/install-piframe.sh`
* `piframe-firstboot.service`
* `piframe-provision.service`
* Offline package/dependency assembly and checksum validation
* WiFi Connect integration, open-AP firewall isolation, and status page

Until those pieces are implemented and tested, this document is the agreed
target behavior rather than an executable release process.
