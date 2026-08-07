import type { IncomingMessage, ServerResponse } from "node:http";
import { createDefaultDisplaySettings, createDefaultFrameSettings, createDefaultScheduleSettings, type DisplaySettings, type FrameSettings, type ScheduleSettings } from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import { isDisplayOn, RandomDisplayPlanner, selectDisplaySlide } from "../display-state.js";
import { sendHtml, sendJson } from "../http/responses.js";
import { renderDisplayPage } from "../views/display.js";

export function handleDisplayRoute(
  context: AppContext,
  randomPlanner: RandomDisplayPlanner,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): boolean {
  if (req.method === "GET" && url.pathname === "/display") {
    const settings = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
    const frame = context.settings.getJson<FrameSettings>("frame") ?? createDefaultFrameSettings();
    sendHtml(res, 200, renderDisplayPage(settings, frame, createPresentationVersion(settings, frame)));
    return true;
  }

  if (req.method !== "GET" || url.pathname !== "/api/display/next") return false;

  const settings = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
  const schedule = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  const frame = context.settings.getJson<FrameSettings>("frame") ?? createDefaultFrameSettings();
  const presentationVersion = createPresentationVersion(settings, frame);
  if (!isDisplayOn(schedule, new Date(), frame.timeZone)) {
    sendJson(res, 200, { displayOn: false, photo: null, photos: [], layout: "single", cursor: null, presentationVersion });
    return true;
  }
  if (url.searchParams.get("probe") === "1") {
    sendJson(res, 200, { displayOn: true, presentationVersion });
    return true;
  }

  const eligible = context.photos.listReady().filter((photo) => {
    return settings.selectedFolderIds.length === 0 || settings.selectedFolderIds.includes(photo.folderId);
  });
  const slide = settings.orderMode === "random"
    ? randomPlanner.next(displaySessionId(url), eligible, settings, frame.displayOrientation)
    : selectDisplaySlide(eligible, settings, url.searchParams.get("after"), frame.displayOrientation);
  const photos = slide.photos.map((photo) => ({
    id: photo.id,
    alt: photo.originalFilename,
    src: `/media/display/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}`
  }));
  sendJson(res, 200, { displayOn: true, photo: photos[0] ?? null, photos, layout: slide.layout, cursor: slide.cursor, presentationVersion });
  return true;
}

function displaySessionId(url: URL): string {
  const value = url.searchParams.get("session") ?? "default";
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : "default";
}

function createPresentationVersion(settings: DisplaySettings, frame: FrameSettings): string {
  return JSON.stringify({ display: settings, language: frame.language, timeZone: frame.timeZone, displayOrientation: frame.displayOrientation });
}
