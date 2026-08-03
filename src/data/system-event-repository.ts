import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface SystemEventRecord {
  id: string;
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
}

interface SystemEventRow {
  id: string;
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  details_json: string | null;
  created_at: string;
}

export class SystemEventRepository {
  private readonly createStatement: Database.Statement<{
    id: string;
    level: "info" | "warning" | "error";
    code: string;
    message: string;
    detailsJson: string | null;
    createdAt: string;
  }>;
  private readonly listRecentStatement: Database.Statement<[number], SystemEventRow>;

  constructor(db: Database.Database) {
    this.createStatement = db.prepare(`
      INSERT INTO system_events (id, level, code, message, details_json, created_at)
      VALUES (@id, @level, @code, @message, @detailsJson, @createdAt)
    `);

    this.listRecentStatement = db.prepare(`
      SELECT id, level, code, message, details_json, created_at
      FROM system_events
      ORDER BY created_at DESC
      LIMIT ?
    `);
  }

  record(
    level: "info" | "warning" | "error",
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): void {
    this.createStatement.run({
      id: randomUUID(),
      level,
      code,
      message,
      detailsJson: details ? JSON.stringify(details) : null,
      createdAt: new Date().toISOString()
    });
  }

  listRecent(limit: number): SystemEventRecord[] {
    return this.listRecentStatement.all(limit).map((row) => ({
      id: row.id,
      level: row.level,
      code: row.code,
      message: row.message,
      detailsJson: row.details_json,
      createdAt: row.created_at
    }));
  }
}
