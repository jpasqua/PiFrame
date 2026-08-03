import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface FolderRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
}

interface FolderRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  photo_count: number;
}

export class FolderRepository {
  private readonly listStatement: Database.Statement<[], FolderRow>;
  private readonly createStatement: Database.Statement<
    {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    }
  >;
  private readonly renameStatement: Database.Statement<
    {
      id: string;
      name: string;
      updatedAt: string;
    }
  >;
  private readonly deleteStatement: Database.Statement<{ id: string }>;
  private readonly getStatement: Database.Statement<{ id: string }, FolderRow>;

  constructor(private readonly db: Database.Database) {
    this.listStatement = db.prepare(`
      SELECT
        folders.id,
        folders.name,
        folders.created_at,
        folders.updated_at,
        COUNT(photos.id) AS photo_count
      FROM folders
      LEFT JOIN photos ON photos.folder_id = folders.id
      GROUP BY folders.id
      ORDER BY folders.name COLLATE NOCASE ASC
    `);

    this.createStatement = db.prepare(`
      INSERT INTO folders (id, name, created_at, updated_at)
      VALUES (@id, @name, @createdAt, @updatedAt)
    `);

    this.renameStatement = db.prepare(`
      UPDATE folders
      SET name = @name, updated_at = @updatedAt
      WHERE id = @id
    `);

    this.deleteStatement = db.prepare(`
      DELETE FROM folders
      WHERE id = @id
    `);
    this.getStatement = db.prepare(`
      SELECT folders.id, folders.name, folders.created_at, folders.updated_at, COUNT(photos.id) AS photo_count
      FROM folders LEFT JOIN photos ON photos.folder_id = folders.id
      WHERE folders.id = @id GROUP BY folders.id
    `);
  }

  list(): FolderRecord[] {
    return this.listStatement.all().map(mapFolderRow);
  }

  get(id: string): FolderRecord | null {
    const row = this.getStatement.get({ id });
    return row ? mapFolderRow(row) : null;
  }

  create(name: string): FolderRecord {
    const timestamp = new Date().toISOString();
    const id = randomUUID();

    this.createStatement.run({
      id,
      name,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return {
      id,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      photoCount: 0
    };
  }

  rename(id: string, name: string): boolean {
    const result = this.renameStatement.run({
      id,
      name,
      updatedAt: new Date().toISOString()
    });
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.deleteStatement.run({ id });
    return result.changes > 0;
  }
}

function mapFolderRow(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photoCount: row.photo_count
  };
}
