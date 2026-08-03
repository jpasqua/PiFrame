# PiFrame

PiFrame is a local-first Raspberry Pi digital picture frame built with Node.js, TypeScript, and SQLite. It is designed to run on Raspberry Pi 4/5 in Chromium kiosk mode while remaining easy to develop on macOS with Pi-specific behavior isolated behind adapters.

## Current status

This repository currently contains:

* An initial technical design
* A lightweight Node.js and TypeScript server
* SQLite bootstrap and first-run schema migration
* Managed storage directory creation under `data/`
* SQLite-backed album administration
* Single-image upload with byte-level image validation and managed original-file storage
* Explicit duplicate filename choices: keep both, replace, or skip
* Per-album photo library views with persisted image metadata
* Background thumbnail and display-derivative generation with durable processing status
* A basic full-screen slideshow using only ready display derivatives
* Explicit display settings for source albums, photo duration, and image fit/fill mode
* Per-photo non-destructive rotation controls with automatic derivative regeneration
* Ready-image thumbnail previews and confirmed photo deletion from the library
* Single or three-photo slideshow layouts with configurable ordering
* A daily schedule with force-on/force-off overrides and black-screen off behavior
* Optional local clock overlay with configurable format, size, date, and seconds
* A unified owner workspace at the homepage, with sidebar views for Dashboard, General, Display, Schedule, Albums, and System Status
* An About dialog available from the PiFrame logo on every page
* Inline album rename plus two-confirmation album deletion that removes every contained photo and managed file
* Default display and schedule settings bootstrap
* Basic system status and event reporting in the unified workspace

## Architectural direction

The initial release is being built in this order:

1. Photo storage and metadata correctness
2. Background preprocessing and derivatives
3. Slideshow/display as a consumer of prepared assets

## Planned stack

* Runtime: Node.js
* Language: TypeScript
* Database: SQLite via `better-sqlite3`
* Served UI: lightweight HTML/CSS/TypeScript
* Target kiosk: Chromium on Raspberry Pi OS

## Build, run, test

## Requirements

* Node.js 22 or newer
* npm 10 or newer

## Install

```bash
npm install
```

## Run in development

```bash
npm run dev
```

If you want automatic restart on file changes, use:

```bash
npm run dev:watch
```

By default the app uses:

* Host: `127.0.0.1` (local-only)
* Port: `3040`
* Data root: `./data`

Useful environment variables:

* `PIFRAME_HOST` (defaults to `127.0.0.1`; use `localhost` or `127.0.0.1` for local-only access)
* `PIFRAME_PORT`
* `PIFRAME_DATA_ROOT`
* `PIFRAME_PLATFORM` with `desktop` or `raspberry-pi`

Example:

```bash
PIFRAME_HOST=127.0.0.1 PIFRAME_PORT=3040 npm run dev
```

Development mode uses Node with the `tsx` loader so the `.ts` source runs directly while the codebase keeps `.js` import specifiers for the compiled `dist/` output.

## Build for production

```bash
npm run build
```

This compiles TypeScript into `dist/`.

## Run the built server

```bash
npm start
```

## Raspberry Pi kiosk templates

The repository includes deployment templates, but does not install or enable anything automatically:

* `deploy/systemd/piframe.service.example` runs the built server as the `pi` user on loopback only.
* `deploy/autostart/piframe-kiosk.desktop.example` starts Chromium in kiosk mode at `/display` when the desktop session starts.

Before using them on a Pi, update the service `WorkingDirectory` and `User` if your installation differs from `/opt/piframe` and `pi`. Confirm Chromium's executable name with `command -v chromium`; some Raspberry Pi OS versions use `chromium-browser` instead.

## Test and verification

There is not a full automated test suite yet. For now, the main verification commands are:

```bash
npm run check
npm run build
```

What they do:

* `npm run check` runs the TypeScript typecheck without emitting files.
* `npm run build` performs a full compile into `dist/`.

Manual smoke checks once the server is running:

* `GET /health`
* `GET /` (the primary workspace; Dashboard is the default view)
* `GET /admin/folders`
* `GET /admin/settings` (redirects to the primary workspace)
* `GET /admin/status` (redirects to the System Status workspace view)
* `GET /admin/display`
* `GET /admin/schedule`
* `GET /display`
* Create an album, open it, and upload a JPEG, PNG, WebP, GIF, TIFF, AVIF, or HEIF image no larger than 25 MB
* Upload the same displayed filename again and verify the explicit conflict decision screen

Expected behavior:

* `data/` is created automatically on first run
* `data/app.db` is initialized automatically
* album create, rename, and delete actions persist in SQLite
* uploaded original bytes are stored under `data/originals/` and associated metadata is stored in SQLite
* duplicate filenames are never silently overwritten
* successful uploads move from `pending` to `ready` after derivatives are generated; pending work is resumed when the server starts
* display settings persist after saving and affect `/display` on its next photo refresh
* saving a photo rotation preserves the original upload and refreshes its display assets
* deleting a photo removes its SQLite record, managed original, and generated derivatives
* deleting an album requires two confirmations and removes the album plus all contained photos and managed files
* a forced-off schedule makes `/display` black within five seconds; scheduled times use the host machine's local time
* recent album actions appear on the status page

## Repository highlights

* `src/server.ts` starts the HTTP server
* `src/config.ts` loads config and prepares managed directories
* `src/data/` contains SQLite bootstrap and repositories
* `src/core/` contains domain validation and default settings
* `src/web/app.ts` contains the current admin and status routes
* `docs/technical-design.md` captures the current architecture and milestone plan

## Current routes

* `/health`
* `/` (unified workspace; Dashboard is the default view)
* `/admin/folders`
* `/admin/settings` (redirects to `/`)
* `/admin/folders/:folderId/photos`
* `/admin/status` (redirects to `/?view=status`)
* `/admin/display`
* `/admin/schedule`
* `/display`
* `/api/display/next`
* `/media/thumbnail/:photoId.jpg`
* `/media/display/:photoId.jpg`

## Next steps

1. Add photo metadata editing beyond rotation
2. Add configurable transitions and clock overlays
3. Add Raspberry Pi kiosk startup and service installation guidance
