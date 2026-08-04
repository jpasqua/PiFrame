# Database

PiFrame stores its application metadata in a local SQLite database. The database is not used to store image bytes: original uploads and generated image assets remain as files on disk.

## Location and lifecycle

By default, the database file is `<project>/data/app.db`. The data-root directory can be changed with the `PIFRAME_DATA_ROOT` environment variable; the database is then stored as `app.db` beneath that directory. `src/config.ts` creates the data-root directories at startup, and `src/data/database.ts` opens the database.

On every open, PiFrame enables:

- WAL journal mode, which improves concurrent read/write behavior for the administration UI and the display viewer.
- Foreign-key enforcement.
- A 5-second SQLite busy timeout.

Schema migrations run automatically before repositories are constructed. They are tracked with SQLite's `PRAGMA user_version`; the current schema version is **3**. Migrations are transactional.

## What is stored where

| Data | Storage |
| --- | --- |
| Album records, photo metadata, settings, events, slideshow order | SQLite |
| Uploaded originals | `originals/` under the data root |
| Generated thumbnails | `derived/thumbnails/` |
| Generated 1920×1080 display images | `derived/display/` |
| Temporary upload files | `tmp/` |

The `photos.stored_basename` value identifies the managed original file. Generated thumbnail and display names are based on `photos.id`.

## Schema

### `folders`

One row per album.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | Primary key; UUID. |
| `name` | `TEXT` | Required, unique album name. |
| `created_at` | `TEXT` | ISO 8601 creation timestamp. |
| `updated_at` | `TEXT` | ISO 8601 last-change timestamp. |

`PhotoRepository` references each folder through `photos.folder_id`. Foreign keys are restrictive, so application code deletes a folder's managed photos and files before removing the folder record.

### `photos`

One row per uploaded image.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | Primary key; UUID. Also names generated derivatives. |
| `folder_id` | `TEXT` | Required foreign key to `folders.id`. |
| `original_filename` | `TEXT` | Filename supplied by the uploader. |
| `stored_basename` | `TEXT` | Unique managed-original filename. |
| `mime_type` | `TEXT` | Uploaded file media type. |
| `file_size_bytes` | `INTEGER` | Original upload size. |
| `width_px`, `height_px` | `INTEGER` | Source image dimensions when known. |
| `capture_date` | `TEXT` | Optional EXIF capture timestamp. |
| `exif_orientation` | `INTEGER` | Optional original EXIF orientation. |
| `manual_rotation_degrees` | `INTEGER` | User-selected non-destructive rotation: 0, 90, 180, or 270. |
| `manual_position` | `INTEGER` | Per-album sequence used by Manual ordering. |
| `processing_status` | `TEXT` | `pending`, `processing`, `ready`, or `failed`. |
| `processing_error` | `TEXT` | Error description when processing fails. |
| `created_at`, `updated_at` | `TEXT` | ISO 8601 timestamps. |

Indexes:

- `photos_folder_id_idx` on `folder_id`, supporting album lookups.
- `photos_folder_manual_position_idx` on `(folder_id, manual_position)`, supporting manual album sequence retrieval.

New uploads receive the next available `manual_position` in their album. A replacement upload retains the existing row and its position. Dragging in Album Grid validates that the submitted IDs are exactly that album's photo set, then rewrites their positions in a transaction.

### `settings`

Key/value storage for application settings.

| Column | Type | Notes |
| --- | --- | --- |
| `key` | `TEXT` | Primary key. |
| `value_json` | `TEXT` | JSON-encoded settings object. |
| `updated_at` | `TEXT` | ISO 8601 update timestamp. |

The application creates defaults when missing for these keys:

- `frame`: identity, location/time zone, language, and display orientation.
- `display`: selected albums, duration, ordering, layout, image presentation, transitions, and clock preferences.
- `schedule`: daily on/off schedule and override state.

Settings are upserted as complete JSON objects. The display viewer includes a settings-derived presentation version in its API response; it reloads when that version changes.

### `system_events`

Append-only operational history shown in the system-status view.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | Primary key; UUID. |
| `level` | `TEXT` | `info`, `warning`, or `error`. |
| `code` | `TEXT` | Machine-oriented event name. |
| `message` | `TEXT` | Human-readable summary. |
| `details_json` | `TEXT` | Optional JSON detail payload. |
| `created_at` | `TEXT` | ISO 8601 creation timestamp. |

Recent events are read in descending creation order. Events include album changes, uploads, image processing, manual-order saves, and settings changes.

## Migrations

Migration 1 creates the base tables and the `photos_folder_id_idx` index. Migration 2 adds `photos.processing_error`. Migration 3 adds `photos.manual_position`, initializes existing images in each album by their original creation order, and creates the composite manual-order index.

When adding a future migration, append a new `if (currentVersion < N)` block in `src/data/database.ts`, run it inside a transaction, and set `PRAGMA user_version = N` only after it succeeds.

## Backup and recovery

Back up the database together with the complete data root. The database alone preserves albums, ordering, settings, and metadata, but it does not contain originals or generated images. Conversely, restoring only original files will not restore their database records.

With WAL enabled, use SQLite's backup mechanism or stop PiFrame before making a filesystem-level copy, so the main database and any WAL state are captured consistently.
