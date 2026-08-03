# PiFrame

PiFrame is a local-first digital picture frame built with Node.js, TypeScript, SQLite, and Sharp. It runs as a lightweight local web application: the owner workspace manages albums and display settings, while `/display` is the Chromium-kiosk-friendly slideshow view.

## Current Features

* SQLite-backed albums and managed photo storage
* Unified owner workspace with Dashboard, General, Display, Schedule, Albums, and System Status views
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

```bash
npm install
```

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

By default, PiFrame uses `127.0.0.1`, port `3040`, and the local `./data` directory. It intentionally does not bind to `0.0.0.0`.

Useful environment variables:

* `PIFRAME_HOST` defaults to `127.0.0.1`
* `PIFRAME_PORT` defaults to `3040`
* `PIFRAME_DATA_ROOT` defaults to `./data`
* `PIFRAME_PLATFORM` accepts `desktop` or `raspberry-pi`

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

## Raspberry Pi Kiosk Templates

The repository includes templates but does not install or enable them automatically:

* `deploy/systemd/piframe.service.example` runs the built server as the `pi` user on loopback.
* `deploy/autostart/piframe-kiosk.desktop.example` starts Chromium in kiosk mode at `/display`.

Before using them, update `WorkingDirectory` and `User` for the target Pi. Confirm the Chromium executable with `command -v chromium`; some Raspberry Pi OS versions use `chromium-browser`.

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
