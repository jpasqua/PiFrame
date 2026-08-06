# PiFrame Technical Design

This document records implementation boundaries and architectural decisions. For installation, running, manual verification, runtime paths, and feature usage, see the repository [README](../README.md).

## Architectural Shape

PiFrame is a single local Node.js process. It owns HTTP handling, SQLite access, photo processing, and lightweight background work. The application deliberately has no external database, queue service, or cloud account dependency for its core library and display features.

The source is divided into four active layers:

* `src/core/` defines domain validation and typed settings defaults.
* `src/data/` owns SQLite startup, schema migrations, and repositories.
* `src/services/` owns side-effectful workflows such as ingestion, derivative generation, staged-upload cleanup, and reverse geocoding.
* `src/web/` separates route handlers, server-rendered views, HTTP helpers, and static browser assets.

`src/web/app.ts` is intentionally limited to route ordering and service construction. Routes own request behavior, views own HTML generation, and browser interactions live in served static JavaScript. This separation avoids coupling request mutation logic to templates or inline scripts.

## Persistence Model

SQLite runs in WAL mode with foreign keys enabled and a busy timeout. Schema changes are applied by monotonic `PRAGMA user_version` migrations at startup.

The current persistent records are:

* `folders`: albums with unique display names.
* `photos`: one album relationship, original-file metadata, managed storage basename, image dimensions, EXIF orientation, manual rotation, and processing state.
* `settings`: version-tolerant JSON documents keyed by concern: `frame`, `display`, and `schedule`.
* `system_events`: durable informational and error events surfaced in System Status.

The `frame` setting has a stable internal ID plus friendly name, description, location, IANA time zone, language, and physical display orientation. Missing settings are initialized at startup. Older frame records that stored `locale` are migrated to the current `language: "en-US"` shape.

## Photo Lifecycle

An upload is streamed to the managed temporary directory, validated with Sharp, and recorded only after the user resolves any filename conflict. The original file is retained under a generated basename; its user-visible filename remains metadata.

Photo processing is an in-process serial queue. Startup re-enqueues pending work. Each successful photo produces independently replaceable thumbnail and display JPEG derivatives. The original is never modified for rotation: EXIF auto-orientation and the persisted manual rotation are applied only while generating derivatives. Failures are persisted with a message and can be retried from the album view.

File/database operations are not yet a fully transactional filesystem protocol. Reconciliation of interrupted operations remains a planned reliability improvement.

## Display and Time Model

The kiosk display requests the next ready photo set from the local API. Selection applies the saved album scope, ordering mode, and one- or three-photo layout. When the schedule is off, the display stays black; the Raspberry Pi display controller also puts the HDMI output into standby.

Schedule evaluation uses the frame's saved IANA time zone rather than the host process time zone. The browser clock uses the same saved time zone and configured language. Physical orientation is passed to the display renderer, which adapts the layout for portrait orientations. On a Raspberry Pi, the display controller also applies the saved orientation to the discovered HDMI output through `wlr-randr`.

## Location Provider Boundary

Location assistance is optional and explicitly initiated by the browser user. Browser coordinates are sent to PiFrame's local reverse-lookup endpoint for a place name and directly to Open-Meteo for time-zone resolution. The `LocationLookupService` serializes public Nominatim requests to at most one per second and caches rounded coordinates in memory. It returns a nearby city, region, and country.

Typed location search and coordinate-to-time-zone resolution use Open-Meteo directly from the browser. Nominatim is isolated behind the service module so it can be replaced if policy, availability, or deployment requirements change. Provider attribution appears in the UI. Location is stored only after the user saves General settings.

## HTTP Boundaries

The server binds to loopback by default. State-changing requests check the request origin, but that is not authentication. Static assets and managed photo derivatives are served through explicit route handlers; managed paths are derived from UUID-backed records rather than client-supplied filesystem paths.

The public HTTP shape comprises owner workspace pages, kiosk display and selection endpoints, managed image media, health reporting, and narrowly scoped JSON actions. Legacy administration URLs redirect into the unified workspace rather than maintaining separate page implementations.

## Future Platform Boundary

Raspberry Pi work should be introduced behind a dedicated platform adapter boundary rather than embedded in web routes or display rendering. That adapter will own kiosk restart recovery, HDMI standby, hostname application, network diagnostics, and installation integration.

Before non-loopback administration is enabled, PiFrame needs an authentication and authorization design. Backup/restore and database/filesystem reconciliation are also prerequisites for a robust appliance deployment.
