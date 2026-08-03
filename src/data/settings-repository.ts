import type Database from "better-sqlite3";

export class SettingsRepository {
  private readonly getStatement: Database.Statement<[string], SettingRow | undefined>;
  private readonly putStatement: Database.Statement<{
    key: string;
    valueJson: string;
    updatedAt: string;
  }>;

  constructor(db: Database.Database) {
    this.getStatement = db.prepare(`
      SELECT key, value_json, updated_at
      FROM settings
      WHERE key = ?
    `);

    this.putStatement = db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (@key, @valueJson, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
  }

  getJson<T>(key: string): T | null {
    const row = this.getStatement.get(key);
    if (!row) {
      return null;
    }

    return JSON.parse(row.value_json) as T;
  }

  putJson<T>(key: string, value: T): void {
    this.putStatement.run({
      key,
      valueJson: JSON.stringify(value),
      updatedAt: new Date().toISOString()
    });
  }
}

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}
