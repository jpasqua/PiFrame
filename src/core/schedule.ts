import type { ScheduleSettings } from "./settings.js";

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

function timeOfDayToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
