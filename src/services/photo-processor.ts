import { rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp, { type Sharp } from "sharp";
import type { AppConfig } from "../config.js";
import type { PhotoRecord, PhotoRepository } from "../data/photo-repository.js";
import type { SystemEventRepository } from "../data/system-event-repository.js";

const MAX_INPUT_PIXELS = 100_000_000;
const THUMBNAIL_SIZE = 480;
const DISPLAY_WIDTH = 1920;
const DISPLAY_HEIGHT = 1080;

export class PhotoProcessor {
  private readonly queuedPhotoIds = new Set<string>();
  private isDraining = false;

  constructor(
    private readonly config: AppConfig,
    private readonly photos: PhotoRepository,
    private readonly events: SystemEventRepository
  ) {}

  enqueue(photoId: string): void {
    this.queuedPhotoIds.add(photoId);
    void this.drain();
  }

  processPending(): void {
    for (const photo of this.photos.listPending()) {
      this.queuedPhotoIds.add(photo.id);
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.isDraining) {
      return;
    }
    this.isDraining = true;
    try {
      for (;;) {
        const photoId = this.queuedPhotoIds.values().next().value;
        if (!photoId) {
          return;
        }
        this.queuedPhotoIds.delete(photoId);
        await this.process(photoId);
      }
    } finally {
      this.isDraining = false;
      if (this.queuedPhotoIds.size > 0) {
        void this.drain();
      }
    }
  }

  private async process(photoId: string): Promise<void> {
    const photo = this.photos.get(photoId);
    if (!photo || photo.processingStatus === "failed") {
      return;
    }
    this.photos.setProcessingStatus(photo.id, "processing");

    try {
      const originalPath = resolveManagedPath(this.config.paths.originalsDir, photo.storedBasename);
      // Auto-orient first, then apply the user's non-destructive rotation adjustment.
      const oriented = await sharp(originalPath, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate().toBuffer();
      const rotation = normalizeRotation(photo.manualRotationDegrees);
      await Promise.all([
        writeDerivative(
          resolve(this.config.paths.thumbnailsDir, `${photo.id}.jpg`),
          sharp(oriented).rotate(rotation).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 })
        ),
        writeDerivative(
          resolve(this.config.paths.displayDir, `${photo.id}.jpg`),
          sharp(oriented).rotate(rotation).resize(DISPLAY_WIDTH, DISPLAY_HEIGHT, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 })
        )
      ]);
      this.photos.setProcessingStatus(photo.id, "ready");
      this.events.record("info", "photo.processed", "Photo derivatives generated.", { photoId: photo.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing error";
      this.photos.setProcessingFailure(photo.id, message);
      this.events.record("error", "photo.processing_failed", "Photo derivative generation failed.", {
        photoId: photo.id,
        error: message
      });
    }
  }
}

async function writeDerivative(destinationPath: string, pipeline: Sharp): Promise<void> {
  const data = await pipeline.toBuffer();
  const temporaryPath = `${destinationPath}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, destinationPath);
}

function normalizeRotation(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

function resolveManagedPath(directory: string, filename: string): string {
  const resolved = resolve(directory, filename);
  if (!resolved.startsWith(`${directory}/`)) {
    throw new Error("Invalid managed image path.");
  }
  return resolved;
}
