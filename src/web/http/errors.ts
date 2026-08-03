import Database from "better-sqlite3";

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Database.SqliteError && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE";
}
