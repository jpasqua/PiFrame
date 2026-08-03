import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import sharp, { type Metadata } from "sharp";
import type { AppConfig } from "../config.js";
import type { NewPhoto, PhotoRecord, PhotoRepository } from "../data/photo-repository.js";

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

export interface StagedUpload {
  tempBasename: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  captureDate: string | null;
  exifOrientation: number | null;
}

export interface UploadFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface StreamedUploadFile {
  filename: string;
  contentType: string;
  tempBasename: string;
  fileSizeBytes: number;
}

export class PhotoIngestionService {
  constructor(
    private readonly config: AppConfig,
    private readonly photos: PhotoRepository
  ) {}

  async stage(file: UploadFile): Promise<StagedUpload> {
    if (file.data.length === 0) {
      throw new Error("Choose an image file to upload.");
    }
    if (file.data.length > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error("Images must be 25 MB or smaller.");
    }

    const filename = sanitizeUploadFilename(file.filename);
    if (!filename) {
      throw new Error("The selected filename is not valid.");
    }

    let metadata: Metadata;
    try {
      metadata = await sharp(file.data, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
    } catch {
      throw new Error("The selected file is not a supported image.");
    }

    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new Error("The selected image could not be read.");
    }

    const extension = extensionForFormat(metadata.format);
    if (!extension) {
      throw new Error("Only JPEG, PNG, WebP, GIF, TIFF, AVIF, and HEIF images are supported.");
    }

    const tempBasename = `${randomUUID()}${extension}`;
    await writeFile(resolve(this.config.paths.tempDir, tempBasename), file.data, { flag: "wx" });

    return {
      tempBasename,
      originalFilename: filename,
      mimeType: mimeForFormat(metadata.format),
      fileSizeBytes: file.data.length,
      widthPx: metadata.width,
      heightPx: metadata.height,
      captureDate: null,
      exifOrientation: metadata.orientation ?? null
    };
  }

  async stageStreamed(file: StreamedUploadFile): Promise<StagedUpload> {
    const sourcePath = resolveManagedPath(this.config.paths.tempDir, file.tempBasename);
    try {
      if (file.fileSizeBytes === 0) {
        throw new Error("Choose an image file to upload.");
      }
      if (file.fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error("Images must be 25 MB or smaller.");
      }

      const originalFilename = sanitizeUploadFilename(file.filename);
      if (!originalFilename) {
        throw new Error("The selected filename is not valid.");
      }

      let metadata: Metadata;
      try {
        metadata = await sharp(sourcePath, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
      } catch {
        throw new Error("The selected file is not a supported image.");
      }
      if (!metadata.format || !metadata.width || !metadata.height) {
        throw new Error("The selected image could not be read.");
      }

      const extension = extensionForFormat(metadata.format);
      if (!extension) {
        throw new Error("Only JPEG, PNG, WebP, GIF, TIFF, AVIF, and HEIF images are supported.");
      }

      const tempBasename = `${randomUUID()}${extension}`;
      await rename(sourcePath, resolve(this.config.paths.tempDir, tempBasename));
      return {
        tempBasename,
        originalFilename,
        mimeType: mimeForFormat(metadata.format),
        fileSizeBytes: file.fileSizeBytes,
        widthPx: metadata.width,
        heightPx: metadata.height,
        captureDate: null,
        exifOrientation: metadata.orientation ?? null
      };
    } catch (error) {
      await rm(sourcePath, { force: true });
      throw error;
    }
  }

  findConflict(folderId: string, filename: string): PhotoRecord | null {
    return this.photos.findByOriginalFilename(folderId, filename);
  }

  async loadStaged(tempBasename: string, originalFilename: string): Promise<StagedUpload> {
    const sourcePath = resolveManagedPath(this.config.paths.tempDir, tempBasename);
    const data = await readFile(sourcePath);
    const staged = await this.stageMetadata(tempBasename, sanitizeUploadFilename(originalFilename), data);
    const fileStat = await stat(sourcePath);
    return { ...staged, fileSizeBytes: fileStat.size };
  }

  async commit(folderId: string, staged: StagedUpload, conflictAction: "keep-both" | "replace"): Promise<PhotoRecord> {
    const sourcePath = resolveManagedPath(this.config.paths.tempDir, staged.tempBasename);
    const storedBasename = `${randomUUID()}${extname(staged.tempBasename).toLowerCase()}`;
    const destinationPath = resolve(this.config.paths.originalsDir, storedBasename);
    const details: Omit<NewPhoto, "folderId"> = {
      originalFilename: staged.originalFilename,
      storedBasename,
      mimeType: staged.mimeType,
      fileSizeBytes: staged.fileSizeBytes,
      widthPx: staged.widthPx,
      heightPx: staged.heightPx,
      captureDate: staged.captureDate,
      exifOrientation: staged.exifOrientation
    };

    const existing = this.findConflict(folderId, staged.originalFilename);
    if (conflictAction === "replace" && existing) {
      await rename(sourcePath, destinationPath);
      this.photos.replace(existing.id, details);
      await rm(resolveManagedPath(this.config.paths.originalsDir, existing.storedBasename), { force: true });
      return this.photos.get(existing.id) ?? existing;
    }

    await rename(sourcePath, destinationPath);
    return this.photos.create({ folderId, ...details });
  }

  async discard(tempBasename: string): Promise<void> {
    await rm(resolveManagedPath(this.config.paths.tempDir, tempBasename), { force: true });
  }

  private async stageMetadata(
    tempBasename: string,
    originalFilename: string,
    data: Buffer
  ): Promise<StagedUpload> {
    if (!originalFilename) {
      throw new Error("The selected filename is not valid.");
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(data, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
    } catch {
      throw new Error("The staged image could not be read.");
    }
    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new Error("The staged image could not be read.");
    }
    const extension = extensionForFormat(metadata.format);
    if (!extension || !tempBasename.endsWith(extension)) {
      throw new Error("The staged image format is not supported.");
    }
    return {
      tempBasename,
      originalFilename,
      mimeType: mimeForFormat(metadata.format),
      fileSizeBytes: data.length,
      widthPx: metadata.width,
      heightPx: metadata.height,
      captureDate: null,
      exifOrientation: metadata.orientation ?? null
    };
  }
}

export async function cleanupStaleStagedUploads(config: AppConfig, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const entries = await readdir(config.paths.tempDir, { withFileTypes: true });
  let removed = 0;

  await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const path = resolve(config.paths.tempDir, entry.name);
    const details = await stat(path);
    if (details.mtimeMs < cutoff) {
      await rm(path, { force: true });
      removed += 1;
    }
  }));

  return removed;
}

function sanitizeUploadFilename(filename: string): string {
  return basename(filename).replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

function resolveManagedPath(directory: string, filename: string): string {
  const safeFilename = basename(filename);
  if (!safeFilename || safeFilename !== filename) {
    throw new Error("Invalid managed upload reference.");
  }
  return resolve(directory, safeFilename);
}

function extensionForFormat(format: string): string | null {
  return ({ jpeg: ".jpg", png: ".png", webp: ".webp", gif: ".gif", tiff: ".tiff", avif: ".avif", heif: ".heif" })[format] ?? null;
}

function mimeForFormat(format: string): string {
  return ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", tiff: "image/tiff", avif: "image/avif", heif: "image/heif" })[format] ?? "application/octet-stream";
}
