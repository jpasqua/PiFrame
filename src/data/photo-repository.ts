import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface PhotoRecord {
  id: string;
  folderId: string;
  originalFilename: string;
  storedBasename: string;
  mimeType: string;
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  captureDate: string | null;
  exifOrientation: number | null;
  manualRotationDegrees: number;
  processingStatus: string;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoStats {
  total: number;
  ready: number;
  pending: number;
  processing: number;
  failed: number;
}

interface PhotoRow {
  id: string;
  folder_id: string;
  original_filename: string;
  stored_basename: string;
  mime_type: string;
  file_size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  capture_date: string | null;
  exif_orientation: number | null;
  manual_rotation_degrees: number;
  processing_status: string;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewPhoto {
  folderId: string;
  originalFilename: string;
  storedBasename: string;
  mimeType: string;
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  captureDate: string | null;
  exifOrientation: number | null;
}

export class PhotoRepository {
  private readonly listByFolderStatement: Database.Statement<{ folderId: string }, PhotoRow>;
  private readonly findByNameStatement: Database.Statement<{ folderId: string; originalFilename: string }, PhotoRow>;
  private readonly createStatement: Database.Statement<PhotoRow>;
  private readonly replaceStatement: Database.Statement<Omit<NewPhoto, "folderId"> & { id: string; updatedAt: string }>;
  private readonly getStatement: Database.Statement<{ id: string }, PhotoRow>;
  private readonly listPendingStatement: Database.Statement<[], PhotoRow>;
  private readonly listReadyStatement: Database.Statement<[], PhotoRow>;
  private readonly updateStatusStatement: Database.Statement<{ id: string; status: PhotoProcessingStatus; updatedAt: string }>;
  private readonly updateFailureStatement: Database.Statement<{ id: string; error: string; updatedAt: string }>;
  private readonly updateRotationStatement: Database.Statement<{ id: string; rotation: number; updatedAt: string }>;
  private readonly deleteStatement: Database.Statement<{ id: string }>;
  private readonly statsStatement: Database.Statement<[], PhotoStats>;

  constructor(private readonly db: Database.Database) {
    this.listByFolderStatement = db.prepare(`
      SELECT * FROM photos WHERE folder_id = @folderId ORDER BY created_at DESC
    `);
    this.findByNameStatement = db.prepare(`
      SELECT * FROM photos
      WHERE folder_id = @folderId AND original_filename = @originalFilename
      ORDER BY created_at DESC LIMIT 1
    `);
    this.createStatement = db.prepare(`
      INSERT INTO photos (
        id, folder_id, original_filename, stored_basename, mime_type, file_size_bytes,
        width_px, height_px, capture_date, exif_orientation, manual_rotation_degrees,
        processing_status, created_at, updated_at
      ) VALUES (
        @id, @folder_id, @original_filename, @stored_basename, @mime_type, @file_size_bytes,
        @width_px, @height_px, @capture_date, @exif_orientation, @manual_rotation_degrees,
        @processing_status, @created_at, @updated_at
      )
    `);
    this.replaceStatement = db.prepare(`
      UPDATE photos SET
        original_filename = @originalFilename,
        stored_basename = @storedBasename,
        mime_type = @mimeType,
        file_size_bytes = @fileSizeBytes,
        width_px = @widthPx,
        height_px = @heightPx,
        capture_date = @captureDate,
        exif_orientation = @exifOrientation,
        processing_status = 'pending',
        processing_error = NULL,
        updated_at = @updatedAt
      WHERE id = @id
    `);
    this.getStatement = db.prepare(`SELECT * FROM photos WHERE id = @id`);
    this.listPendingStatement = db.prepare(`SELECT * FROM photos WHERE processing_status = 'pending' ORDER BY created_at ASC`);
    this.listReadyStatement = db.prepare(`SELECT * FROM photos WHERE processing_status = 'ready' ORDER BY created_at ASC`);
    this.updateStatusStatement = db.prepare(`
      UPDATE photos
      SET processing_status = @status, processing_error = NULL, updated_at = @updatedAt
      WHERE id = @id
    `);
    this.updateFailureStatement = db.prepare(`
      UPDATE photos
      SET processing_status = 'failed', processing_error = @error, updated_at = @updatedAt
      WHERE id = @id
    `);
    this.updateRotationStatement = db.prepare(`
      UPDATE photos
      SET manual_rotation_degrees = @rotation, processing_status = 'pending', processing_error = NULL, updated_at = @updatedAt
      WHERE id = @id
    `);
    this.deleteStatement = db.prepare(`DELETE FROM photos WHERE id = @id`);
    this.statsStatement = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(processing_status = 'ready') AS ready,
        SUM(processing_status = 'pending') AS pending,
        SUM(processing_status = 'processing') AS processing,
        SUM(processing_status = 'failed') AS failed
      FROM photos
    `);
  }

  listByFolder(folderId: string): PhotoRecord[] {
    return this.listByFolderStatement.all({ folderId }).map(mapPhotoRow);
  }

  findByOriginalFilename(folderId: string, originalFilename: string): PhotoRecord | null {
    const row = this.findByNameStatement.get({ folderId, originalFilename });
    return row ? mapPhotoRow(row) : null;
  }

  get(id: string): PhotoRecord | null {
    const row = this.getStatement.get({ id });
    return row ? mapPhotoRow(row) : null;
  }

  listPending(): PhotoRecord[] {
    return this.listPendingStatement.all().map(mapPhotoRow);
  }

  listReady(): PhotoRecord[] {
    return this.listReadyStatement.all().map(mapPhotoRow);
  }

  setProcessingStatus(id: string, status: PhotoProcessingStatus): boolean {
    return this.updateStatusStatement.run({ id, status, updatedAt: new Date().toISOString() }).changes > 0;
  }

  setManualRotation(id: string, rotation: number): boolean {
    return this.updateRotationStatement.run({ id, rotation, updatedAt: new Date().toISOString() }).changes > 0;
  }

  setProcessingFailure(id: string, error: string): boolean {
    return this.updateFailureStatement.run({ id, error, updatedAt: new Date().toISOString() }).changes > 0;
  }

  delete(id: string): boolean {
    return this.deleteStatement.run({ id }).changes > 0;
  }

  stats(): PhotoStats {
    const row = this.statsStatement.get();
    return {
      total: Number(row?.total ?? 0),
      ready: Number(row?.ready ?? 0),
      pending: Number(row?.pending ?? 0),
      processing: Number(row?.processing ?? 0),
      failed: Number(row?.failed ?? 0)
    };
  }

  create(photo: NewPhoto): PhotoRecord {
    const timestamp = new Date().toISOString();
    const record: PhotoRow = {
      id: randomUUID(),
      folder_id: photo.folderId,
      original_filename: photo.originalFilename,
      stored_basename: photo.storedBasename,
      mime_type: photo.mimeType,
      file_size_bytes: photo.fileSizeBytes,
      width_px: photo.widthPx,
      height_px: photo.heightPx,
      capture_date: photo.captureDate,
      exif_orientation: photo.exifOrientation,
    manual_rotation_degrees: 0,
    processing_status: "pending",
    processing_error: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    this.createStatement.run(record);
    return mapPhotoRow(record);
  }

  replace(id: string, photo: Omit<NewPhoto, "folderId">): boolean {
    return this.replaceStatement.run({ ...photo, id, updatedAt: new Date().toISOString() }).changes > 0;
  }
}

export type PhotoProcessingStatus = "pending" | "processing" | "ready" | "failed";

function mapPhotoRow(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    folderId: row.folder_id,
    originalFilename: row.original_filename,
    storedBasename: row.stored_basename,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    widthPx: row.width_px,
    heightPx: row.height_px,
    captureDate: row.capture_date,
    exifOrientation: row.exif_orientation,
    manualRotationDegrees: row.manual_rotation_degrees,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
