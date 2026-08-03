import type { IncomingMessage, ServerResponse } from "node:http";
import { createDefaultDisplaySettings, createDefaultScheduleSettings, type DisplaySettings, type ScheduleSettings } from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import { isDisplayOn, selectDisplayPhotos } from "../display-state.js";
import { sendHtml, sendJson } from "../http/responses.js";
import { renderDisplayPage } from "../views/display.js";

export function handleDisplayRoute(
  context: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): boolean {
  if (req.method === "GET" && url.pathname === "/display") {
    const settings = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
    sendHtml(res, 200, renderDisplayPage(settings));
    return true;
  }

  if (req.method !== "GET" || url.pathname !== "/api/display/next") return false;

  const settings = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
  const schedule = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  if (!isDisplayOn(schedule, new Date())) {
    sendJson(res, 200, { displayOn: false, photo: null, photos: [] });
    return true;
  }

  const eligible = context.photos.listReady().filter((photo) => {
    return settings.selectedFolderIds.length === 0 || settings.selectedFolderIds.includes(photo.folderId);
  });
  const photos = selectDisplayPhotos(eligible, settings, url.searchParams.get("after")).map((photo) => ({
    id: photo.id,
    alt: photo.originalFilename,
    src: `/media/display/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}`
  }));
  sendJson(res, 200, { displayOn: true, photo: photos[0] ?? null, photos });
  return true;
}
