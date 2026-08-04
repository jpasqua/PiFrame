import type { DisplaySettings, ScheduleSettings } from "../core/settings.js";
import type { PhotoRecord } from "../data/photo-repository.js";

export function isDisplayOn(settings: ScheduleSettings, now: Date, timeZone = "UTC"): boolean {
  if (settings.overrideState === "force-on") return true;
  if (settings.overrideState === "force-off") return false;
  if (!settings.enabled) return true;
  const currentMinutes = currentTimeInZone(now, timeZone);
  const onMinutes = timeOfDayToMinutes(settings.dailyOnTime);
  const offMinutes = timeOfDayToMinutes(settings.dailyOffTime);
  if (onMinutes === offMinutes) return true;
  return onMinutes < offMinutes
    ? currentMinutes >= onMinutes && currentMinutes < offMinutes
    : currentMinutes >= onMinutes || currentMinutes < offMinutes;
}

function currentTimeInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function selectDisplayPhotos(photos: PhotoRecord[], settings: DisplaySettings, afterId: string | null): PhotoRecord[] {
  return selectDisplaySlide(photos, settings, afterId, 0).photos;
}

export type DisplayLayout = "single" | "portrait-pair" | "landscape-pair" | "landscape-trio" | "portrait-trio";

export interface DisplaySlide { layout: DisplayLayout; photos: PhotoRecord[]; cursor: string | null; }

export function selectDisplaySlide(photos: PhotoRecord[], settings: DisplaySettings, afterId: string | null, displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
  if (photos.length === 0) return { layout: "single", photos: [], cursor: null };
  const candidates = settings.orderMode === "random"
    ? selectRandomPhotos(photos, Math.min(3, photos.length), afterId)
    : selectOrderedPhotos(photos, Math.min(3, photos.length), afterId, settings.orderMode);
  if (settings.screenLayout === "single") {
    const selected = candidates.slice(0, 1);
    return { layout: "single", photos: selected, cursor: selected[0]?.id ?? null };
  }
  return chooseAdaptiveLayout(candidates, displayOrientation);
}

function selectOrderedPhotos(photos: PhotoRecord[], count: number, afterId: string | null, orderMode: DisplaySettings["orderMode"]): PhotoRecord[] {
  const ordered = [...photos].sort((left, right) => compareDisplayPhotos(left, right, orderMode));
  const afterIndex = afterId ? ordered.findIndex((photo) => photo.id === afterId) : -1;
  return Array.from({ length: count }, (_, index) => ordered[(Math.max(afterIndex, -1) + 1 + index) % ordered.length]).filter((photo): photo is PhotoRecord => photo !== undefined);
}

function chooseAdaptiveLayout(candidates: PhotoRecord[], displayOrientation: 0 | 90 | 180 | 270): DisplaySlide {
  const portraitScreen = displayOrientation === 90 || displayOrientation === 270;
  const options: Array<{ layout: DisplayLayout; photos: PhotoRecord[]; score: number }> = [{ layout: "single", photos: candidates.slice(0, 1), score: 1 }];
  const pair = candidates.slice(0, 2);
  const desiredPairShape = portraitScreen ? "landscape" : "portrait";
  if (pair.length === 2 && pair.every((photo) => photoShape(photo) === desiredPairShape)) {
    options.push({ layout: portraitScreen ? "landscape-pair" : "portrait-pair", photos: pair, score: 2.2 });
  }
  const trio = candidates.slice(0, 3);
  const shapes = trio.map(photoShape);
  if (trio.length === 3 && shapes.filter((shape) => shape === "portrait").length === 2 && shapes.includes("landscape")) {
    options.push({ layout: portraitScreen ? "portrait-trio" : "landscape-trio", photos: arrangeByShapes(trio, portraitScreen ? ["portrait", "portrait", "landscape"] : ["landscape", "portrait", "portrait"]), score: 3.1 });
  }
  const best = options.reduce((winner, option) => option.score > winner.score ? option : winner);
  const consumed = candidates.slice(0, best.photos.length);
  return { layout: best.layout, photos: best.photos, cursor: consumed[consumed.length - 1]?.id ?? null };
}

function arrangeByShapes(photos: PhotoRecord[], wanted: Array<"portrait" | "landscape">): PhotoRecord[] {
  const remaining = [...photos];
  return wanted.map((shape) => {
    const index = remaining.findIndex((photo) => photoShape(photo) === shape);
    return remaining.splice(index >= 0 ? index : 0, 1)[0];
  }).filter((photo): photo is PhotoRecord => photo !== undefined);
}

function photoShape(photo: PhotoRecord): "portrait" | "landscape" | "square" {
  let width = photo.widthPx ?? 1;
  let height = photo.heightPx ?? 1;
  if (photo.exifOrientation === 5 || photo.exifOrientation === 6 || photo.exifOrientation === 7 || photo.exifOrientation === 8 || photo.manualRotationDegrees === 90 || photo.manualRotationDegrees === 270) [width, height] = [height, width];
  const ratio = width / height;
  return ratio < .85 ? "portrait" : ratio > 1.15 ? "landscape" : "square";
}

function timeOfDayToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function selectRandomPhotos(photos: PhotoRecord[], count: number, afterId: string | null): PhotoRecord[] {
  const available = photos.filter((photo) => photo.id !== afterId);
  const pool = available.length > 0 ? [...available] : [...photos];
  const selected: PhotoRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    if (pool.length === 0) pool.push(...photos);
    const photo = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (photo) selected.push(photo);
  }
  return selected;
}

function compareDisplayPhotos(left: PhotoRecord, right: PhotoRecord, orderMode: DisplaySettings["orderMode"]): number {
  if (orderMode === "filename-asc") return left.originalFilename.localeCompare(right.originalFilename);
  if (orderMode === "filename-desc") return right.originalFilename.localeCompare(left.originalFilename);
  const leftDate = orderMode.startsWith("capture") ? (left.captureDate ?? left.createdAt) : left.createdAt;
  const rightDate = orderMode.startsWith("capture") ? (right.captureDate ?? right.createdAt) : right.createdAt;
  const comparison = leftDate.localeCompare(rightDate);
  return orderMode.endsWith("newest") ? -comparison : comparison;
}
