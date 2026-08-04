import Database from "better-sqlite3";
import type { AppConfig } from "../config.js";

export interface DatabaseContext {
  db: Database.Database;
}

export function openDatabase(config: AppConfig): DatabaseContext {
  const db = new Database(config.paths.databaseFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);

  return { db };
}

function migrate(db: Database.Database): void {
  const currentVersion = Number(db.pragma("user_version", { simple: true }));

  if (currentVersion < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE photos (
          id TEXT PRIMARY KEY,
          folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
          original_filename TEXT NOT NULL,
          stored_basename TEXT NOT NULL UNIQUE,
          mime_type TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL,
          width_px INTEGER,
          height_px INTEGER,
          capture_date TEXT,
          exif_orientation INTEGER,
          manual_rotation_degrees INTEGER NOT NULL DEFAULT 0,
          processing_status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX photos_folder_id_idx ON photos(folder_id);

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE system_events (
          id TEXT PRIMARY KEY,
          level TEXT NOT NULL,
          code TEXT NOT NULL,
          message TEXT NOT NULL,
          details_json TEXT,
          created_at TEXT NOT NULL
        );
      `);

      db.pragma("user_version = 1");
    })();
  }

  if (currentVersion < 2) {
    db.transaction(() => {
      db.exec("ALTER TABLE photos ADD COLUMN processing_error TEXT");
      db.pragma("user_version = 2");
    })();
  }

  if (currentVersion < 3) {
    db.transaction(() => {
      db.exec("ALTER TABLE photos ADD COLUMN manual_position INTEGER");
      db.exec(`WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY created_at ASC, id ASC) AS position FROM photos
      ) UPDATE photos SET manual_position = (SELECT position FROM ranked WHERE ranked.id = photos.id)`);
      db.exec("CREATE INDEX photos_folder_manual_position_idx ON photos(folder_id, manual_position)");
      db.pragma("user_version = 3");
    })();
  }
}
