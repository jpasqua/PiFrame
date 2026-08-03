import type { IncomingMessage, ServerResponse } from "node:http";
import { createDefaultDisplaySettings, type DisplaySettings, type ScheduleSettings } from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import { readForm } from "../http/forms.js";
import { isTrustedOrigin } from "../http/request.js";
import { redirect, sendPlainText } from "../http/responses.js";
import { settingsLocation } from "../urls.js";

export async function handleSettingsActions(context: AppContext, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/admin/display/save") {
    if (!isTrustedOrigin(req)) { sendPlainText(res, 403, "Forbidden"); return true; }
    try {
      const form = await readForm(req);
      const current = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
      const selectedFolderIds = form.useAllFolders === "on" ? [] : context.folders.list().filter((folder) => form[`folder-${folder.id}`] === "on").map((folder) => folder.id);
      if (form.useAllFolders !== "on" && selectedFolderIds.length === 0) { redirect(res, settingsLocation("display", "error", "Choose at least one album, or use all albums.")); return true; }
      const settings: DisplaySettings = { ...current, selectedFolderIds, photoDurationSeconds: parseInteger(form.photoDurationSeconds, current.photoDurationSeconds, 3, 3600, "Photo duration must be between 3 seconds and 1 hour."), imagePresentationMode: parseEnum(form.imagePresentationMode, current.imagePresentationMode, ["fit", "fill"]), orderMode: parseEnum(form.orderMode, current.orderMode, ["random", "filename-asc", "filename-desc", "upload-newest", "upload-oldest", "capture-newest", "capture-oldest"]), screenLayout: parseEnum(form.screenLayout, current.screenLayout, ["single", "triple"]), clockEnabled: form.clockEnabled === "on", clockFormat: parseEnum(form.clockFormat, current.clockFormat, ["locale-default", "12h", "24h"]), clockShowSeconds: form.clockShowSeconds === "on", clockShowDate: form.clockShowDate === "on", clockSize: parseEnum(form.clockSize, current.clockSize, ["small", "medium", "large"]) };
      context.settings.putJson("display", settings);
      context.events.record("info", "display.settings_saved", "Display settings saved.", { selectedFolderCount: selectedFolderIds.length, useAllFolders: selectedFolderIds.length === 0, photoDurationSeconds: settings.photoDurationSeconds, imagePresentationMode: settings.imagePresentationMode, orderMode: settings.orderMode, screenLayout: settings.screenLayout, clockEnabled: settings.clockEnabled });
      redirect(res, settingsLocation("display", "success", "Display settings saved."));
    } catch (error) { redirect(res, settingsLocation("display", "error", error instanceof Error ? error.message : "Could not save display settings.")); }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/admin/schedule/save") {
    if (!isTrustedOrigin(req)) { sendPlainText(res, 403, "Forbidden"); return true; }
    try {
      const form = await readForm(req);
      const settings: ScheduleSettings = { enabled: form.enabled === "on", dailyOnTime: parseTime(form.dailyOnTime), dailyOffTime: parseTime(form.dailyOffTime), overrideState: parseEnum(form.overrideState, "follow-schedule", ["follow-schedule", "force-on", "force-off"]) };
      context.settings.putJson("schedule", settings);
      context.events.record("info", "schedule.settings_saved", "Schedule settings saved.", { ...settings });
      redirect(res, settingsLocation("schedule", "success", "Schedule settings saved."));
    } catch (error) { redirect(res, settingsLocation("schedule", "error", error instanceof Error ? error.message : "Could not save schedule settings.")); }
    return true;
  }
  return false;
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number, message: string): number { if (!raw?.trim()) return fallback; const value = Number(raw); if (!Number.isInteger(value) || value < min || value > max) throw new Error(message); return value; }
function parseEnum<T extends string>(raw: string | undefined, fallback: T, values: readonly T[]): T { if (!raw) return fallback; if (values.includes(raw as T)) return raw as T; throw new Error("Choose a valid setting."); }
function parseTime(raw: string | undefined): string { if (!raw || !/^\d{2}:\d{2}$/.test(raw)) throw new Error("Enter a valid daily time."); const [hours, minutes] = raw.split(":").map(Number); if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) throw new Error("Enter a valid daily time."); return raw; }
