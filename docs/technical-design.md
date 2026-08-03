# PiFrame Technical Design

## Goals

PiFrame is a self-contained digital photo frame for Raspberry Pi 4 and 5 that:

* boots directly into a kiosk slideshow
* stores photos locally
* provides browser-based administration on the local network
* survives reboots, power loss, and transient failures
* remains largely platform-independent outside Pi-specific display integration

## Confirmed decisions

The following product and implementation choices are now fixed for the initial architecture:

* TypeScript is the primary language across the codebase.
* Node.js is the application runtime.
* SQLite is the embedded data store.
* Native dependencies are acceptable when they materially reduce complexity.
* Chromium kiosk mode is the baseline display target on Raspberry Pi OS.
* Daily display-off behavior starts as a black-screen mode, with true HDMI standby deferred.
* When fewer than three photos are eligible, three-photo layout may reuse a photo.
* Duplicate upload filenames should prompt the user for conflict resolution.
* Manual rotation edits must persist as first-class metadata.
* The administration UI uses explicit Save actions.
* The service binds to loopback (`127.0.0.1`) by default; LAN exposure is an explicit future deployment choice.
* macOS development mode is a first-class workflow.
* The first milestone prioritizes storage and administration over slideshow sophistication.

## System architecture

The system is split into five layers:

1. `core`
   Pure application logic for folders, photos, ordering, schedules, and validation.
2. `data`
   SQLite access, migrations, repositories, and durable configuration storage.
3. `services`
   Long-lived workflows such as preprocessing, slideshow state management, and schedule evaluation.
4. `web`
   Local administration and display HTTP routes, HTML rendering, and lightweight client scripts.
5. `platform`
   Raspberry Pi-specific adapters for kiosk startup, display power behavior, and service integration.

This split lets us run most of the application unchanged on macOS while substituting Pi-specific adapters only where necessary.

## First implementation milestone

The first milestone focuses on admin/storage correctness and leaves the display loop intentionally thin.

Included in milestone 1:

* database initialization and migrations
* managed storage directory layout
* folder CRUD
* photo metadata records
* upload flow and duplicate-resolution hooks
* durable configuration model
* basic status and health endpoints
* macOS-friendly development server

Deferred until after milestone 1:

* polished slideshow rendering
* display scheduling behavior
* advanced transitions
* HDMI-specific power management

## Repository layout

```text
src/
  core/         Domain rules and validation
  data/         SQLite, migrations, repositories
  platform/     Pi-specific and desktop adapters
  services/     Background and orchestration logic
  web/          HTTP routes, rendering, static assets
```

## Runtime model

The initial process model is a single Node.js service hosting:

* HTTP server for administration and display routes
* SQLite access in-process
* background task scheduler for deferred work
* platform adapter selected by environment

This keeps deployment simple for a single-device appliance and aligns with the requirement to avoid an external database server or cloud backend.

## Data model overview

Initial core entities:

* `folders`
  Logical photo collections with unique names.
* `photos`
  Original-file metadata, orientation state, capture metadata, and processing state.
* `photo_folder_membership`
  Optional join structure if we later allow multi-folder assignment; initial version can simplify to one folder per photo.
* `display_settings`
  Folder selection, order mode, duration, transitions, layout, orientation, and clock settings.
* `schedule_settings`
  Daily on/off schedule plus override state.
* `system_events`
  Durable event and warning records surfaced in the admin UI.

## Storage model

Managed storage should live under an application root such as:

```text
data/
  app.db
  config/
  originals/
  derived/
    thumbnails/
    display/
    blurred/
  logs/
  tmp/
```

Key rules:

* original uploads are never overwritten silently
* generated derivatives are disposable and rebuildable
* all filenames are sanitized before persistence
* writes of configuration and metadata must be atomic where practical

## Upload and filename conflict flow

Because duplicate filenames must prompt the user, upload handling should be two-phase:

1. Validate incoming files and extract basic metadata.
2. Detect naming conflicts within the target folder.
3. Return a conflict set to the UI when needed.
4. Apply the chosen resolution action on explicit confirmation.

Likely resolution actions:

* keep both with a generated stored filename
* replace existing photo
* skip incoming file

The original displayed filename remains part of metadata regardless of the stored path.

## Rotation model

Manual rotation should be persisted as metadata, not applied destructively to the original file. Effective orientation for display should be computed from:

* EXIF orientation
* manual rotation delta

Derived assets can bake in the combined result for fast display.

## HTTP surface

Planned endpoint groups:

* `/health`
  Basic liveness and readiness
* `/admin/*`
  Administration pages and JSON actions
* `/display`
  Kiosk slideshow page
* `/api/display/next`
  Ready-photo selection for the kiosk display
* `/admin/schedule`
  Daily schedule and explicit display override controls
* `/assets/*`
  Static CSS, JS, and image assets
* `/media/*`
  Controlled serving of managed derivatives

The initial server can render simple HTML directly and add lightweight client-side behavior only where needed for uploads, previews, and dynamic status.

## Platform adapters

The first adapter boundary should cover:

* launch mode and startup integration
* kiosk browser restart hooks
* display-on/display-off behavior
* hostname and network diagnostics
* system restart and shutdown commands

Initial adapter implementations:

* `desktop`
  No-op or simulated kiosk/display controls for macOS development.
* `raspberry-pi`
  Real startup/display integration added incrementally.

The repository supplies example systemd and desktop-autostart templates for the initial Chromium kiosk path. They remain operator-installed so deployment paths and service users are never assumed or changed by application startup.

## Security posture for v1

Authentication is intentionally omitted for the first release, so the baseline safety measures matter more:

* bind only to the configured LAN port
* reject directory traversal everywhere
* validate file contents, not just extensions
* sanitize all user-provided filenames and folder names
* protect state-changing requests against unwanted cross-origin submission
* avoid third-party hosted frontend assets

## Immediate implementation plan

1. Add dependency installation and lockfile
2. Build configuration loading and path management
3. Add SQLite bootstrap and migrations
4. Implement folder and photo repositories
5. Create admin pages for folders and uploads
6. Generate thumbnail and display derivatives with a lightweight in-process executor
