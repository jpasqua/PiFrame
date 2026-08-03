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
  if (photos.length === 0) return [];
  const count = settings.screenLayout === "triple" ? 3 : 1;
  if (settings.orderMode === "random") return selectRandomPhotos(photos, count, afterId);
  const ordered = [...photos].sort((left, right) => compareDisplayPhotos(left, right, settings.orderMode));
  const afterIndex = afterId ? ordered.findIndex((photo) => photo.id === afterId) : -1;
  const startIndex = afterIndex >= 0 ? afterIndex + 1 : 0;
  return Array.from({ length: count }, (_, index) => ordered[(startIndex + index) % ordered.length]).filter(
    (photo): photo is PhotoRecord => photo !== undefined
  );
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
