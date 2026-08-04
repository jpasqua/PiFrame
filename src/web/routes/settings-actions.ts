import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createDefaultDisplaySettings,
  createDefaultFrameSettings,
  type DisplaySettings,
  type FrameSettings,
  type ScheduleSettings
} from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import { readForm } from "../http/forms.js";
import { isTrustedOrigin } from "../http/request.js";
import { redirect, sendPlainText } from "../http/responses.js";
import { settingsLocation } from "../urls.js";

export async function handleSettingsActions(context: AppContext, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/admin/general/save") {
    if (!isTrustedOrigin(req)) { sendPlainText(res, 403, "Forbidden"); return true; }
    try {
      const form = await readForm(req);
      const current = context.settings.getJson<FrameSettings>("frame") ?? createDefaultFrameSettings();
      const settings: FrameSettings = {
        ...current,
        frameName: parseFrameName(form.frameName),
        frameDescription: parseSingleLine(form.frameDescription, "Frame description", 80),
        location: parseSingleLine(form.location, "Location", 80),
        timeZone: parseTimeZone(form.timeZone),
        language: parseLanguage(form.language),
        displayOrientation: parseOrientation(form.displayOrientation)
      };
      context.settings.putJson("frame", settings);
      context.events.record("info", "frame.settings_saved", "General frame settings saved.", {
        frameName: settings.frameName,
        timeZone: settings.timeZone,
        displayOrientation: settings.displayOrientation
      });
      redirect(res, settingsLocation("general", "success", "General settings saved."));
    } catch (error) {
      redirect(res, settingsLocation("general", "error", error instanceof Error ? error.message : "Could not save general settings."));
    }
    return true;
  }

  if (req.method === "POST" && (url.pathname === "/admin/presentation/save" || url.pathname === "/admin/display/save")) {
    if (!isTrustedOrigin(req)) { sendPlainText(res, 403, "Forbidden"); return true; }
    try {
      const form = await readForm(req);
      const current = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
      const selectedFolderIds = form.useAllFolders === "on" ? [] : parseSelectedFolders(form, context.folders.list().map((folder) => folder.id));
      if (form.useAllFolders !== "on" && selectedFolderIds.length === 0) { redirect(res, settingsLocation("presentation", "error", "Choose at least one album, or use all albums.")); return true; }
      const settings: DisplaySettings = { ...current, selectedFolderIds, photoDurationSeconds: parseInteger(form.photoDurationSeconds, current.photoDurationSeconds, 3, 3600, "Photo duration must be between 3 seconds and 1 hour."), imagePresentationMode: parseEnum(form.imagePresentationMode, current.imagePresentationMode, ["fit", "fill"]), orderMode: parseEnum(form.orderMode, current.orderMode, ["random", "filename-asc", "filename-desc", "upload-newest", "upload-oldest", "capture-newest", "capture-oldest", "manual"]), screenLayout: parseEnum(form.screenLayout, current.screenLayout, ["single", "multiple", "triple"]), clockEnabled: form.clockEnabled === "on", clockFormat: parseEnum(form.clockFormat, current.clockFormat, ["locale-default", "12h", "24h"]), clockShowSeconds: form.clockShowSeconds === "on", clockShowDate: form.clockShowDate === "on", clockSize: parseEnum(form.clockSize, current.clockSize, ["small", "medium", "large"]) };
      context.settings.putJson("display", settings);
      context.events.record("info", "presentation.settings_saved", "Presentation settings saved.", { selectedFolderCount: selectedFolderIds.length, useAllFolders: selectedFolderIds.length === 0, photoDurationSeconds: settings.photoDurationSeconds, imagePresentationMode: settings.imagePresentationMode, orderMode: settings.orderMode, screenLayout: settings.screenLayout, clockEnabled: settings.clockEnabled });
      redirect(res, settingsLocation("presentation", "success", "Presentation settings saved."));
    } catch (error) { redirect(res, settingsLocation("presentation", "error", error instanceof Error ? error.message : "Could not save presentation settings.")); }
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

function parseFrameName(raw: string | undefined): string {
  const name = raw?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9]{1,63}$/.test(name)) throw new Error("Frame name must be one lowercase word using letters and numbers only.");
  return name;
}

function parseSingleLine(raw: string | undefined, label: string, maxLength: number): string {
  const value = raw?.trim() ?? "";
  if (value.includes("\n") || value.length > maxLength) throw new Error(`${label} must be one line of at most ${maxLength.toString()} characters.`);
  return value;
}

function parseTimeZone(raw: string | undefined): string {
  if (!raw || !Intl.supportedValuesOf("timeZone").includes(raw)) throw new Error("Choose a valid time zone.");
  return raw;
}

function parseLanguage(raw: string | undefined): FrameSettings["language"] {
  if (raw === "en-US") return raw;
  throw new Error("Choose a supported language.");
}

function parseOrientation(raw: string | undefined): FrameSettings["displayOrientation"] {
  if (raw === "0" || raw === "90" || raw === "180" || raw === "270") return Number(raw) as FrameSettings["displayOrientation"];
  throw new Error("Choose a valid display orientation.");
}

function parseSelectedFolders(form: Record<string, string>, folderIds: string[]): string[] {
  const selected = folderIds.filter((folderId) => form[`folder-${folderId}`] === "on");
  const selectedSet = new Set(selected);
  try {
    const requested = JSON.parse(form.folderOrder ?? "[]");
    if (!Array.isArray(requested) || !requested.every((folderId) => typeof folderId === "string")) return selected;
    const ordered = requested.filter((folderId): folderId is string => selectedSet.has(folderId));
    const missing = selected.filter((folderId) => !ordered.includes(folderId));
    return [...ordered, ...missing];
  } catch {
    return selected;
  }
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number, message: string): number { if (!raw?.trim()) return fallback; const value = Number(raw); if (!Number.isInteger(value) || value < min || value > max) throw new Error(message); return value; }
function parseEnum<T extends string>(raw: string | undefined, fallback: T, values: readonly T[]): T { if (!raw) return fallback; if (values.includes(raw as T)) return raw as T; throw new Error("Choose a valid setting."); }
function parseTime(raw: string | undefined): string { if (!raw || !/^\d{2}:\d{2}$/.test(raw)) throw new Error("Enter a valid daily time."); const [hours, minutes] = raw.split(":").map(Number); if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) throw new Error("Enter a valid daily time."); return raw; }
