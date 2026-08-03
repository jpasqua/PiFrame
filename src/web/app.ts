import { readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createDefaultDisplaySettings, createDefaultScheduleSettings, type DisplaySettings, type ScheduleSettings } from "../core/settings.js";
import { validateFolderName } from "../core/folders.js";
import type { AppContext } from "../data/app-context.js";
import type { PhotoRecord } from "../data/photo-repository.js";
import { PhotoIngestionService, type StagedUpload } from "../services/photo-ingestion.js";
import { isUniqueConstraintError } from "./http/errors.js";
import { readForm, readMultipartUpload, requireFormValue } from "./http/forms.js";
import { isTrustedOrigin, prefersHtml, prefersJson } from "./http/request.js";
import { redirect, sendBinary, sendHtml, sendJson, sendPlainText } from "./http/responses.js";
import { isDisplayOn, selectDisplayPhotos } from "./display-state.js";
import { handleDisplayRoute } from "./routes/display.js";
import { escapeHtml, formatBytes, formatTimestamp, readFlash, renderFlash, renderLogo, type FlashMessage } from "./views/shared.js";

interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export function createApp(context: AppContext): App {
  const ingestion = new PhotoIngestionService(context.config, context.photos);

  return {
    async handle(req, res) {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (method === "GET" && url.pathname === "/health") {
        if (prefersHtml(req)) {
          return sendHtml(res, 200, renderHealthPage(context));
        }
        return sendJson(res, 200, {
          ok: true,
          platform: context.config.platform,
          dataRoot: context.config.paths.dataRoot
        });
      }

      if (method === "GET" && url.pathname === "/assets/images/PiFrame_Words_Right.png") {
        try {
          const image = await readFile(resolve(process.cwd(), "assets", "images", "PiFrame_Words_Right.png"));
          return sendBinary(res, 200, image, "image/png");
        } catch {
          return sendPlainText(res, 404, "Asset not found.");
        }
      }

      if (handleDisplayRoute(context, req, res, url, renderDisplayPage)) return;

      const mediaMatch = url.pathname.match(/^\/media\/(thumbnail|display)\/([0-9a-f-]{36})\.jpg$/);
      if (method === "GET" && mediaMatch) {
        const variant = mediaMatch[1];
        const photoId = mediaMatch[2];
        const photo = photoId ? context.photos.get(photoId) : null;
        if (!variant || !photo || photo.processingStatus !== "ready") {
          return sendPlainText(res, 404, "Image not found.");
        }
        const directory = variant === "thumbnail" ? context.config.paths.thumbnailsDir : context.config.paths.displayDir;
        try {
          const image = await readFile(resolve(directory, `${photo.id}.jpg`));
          return sendBinary(res, 200, image, "image/jpeg");
        } catch {
          return sendPlainText(res, 404, "Image not found.");
        }
      }

      if (method === "GET" && url.pathname === "/") {
        return sendHtml(res, 200, renderSettingsPage(context, readFlash(url), url.searchParams.get("view") ?? url.searchParams.get("section")));
      }

      if (method === "GET" && url.pathname === "/admin") {
        return redirect(res, "/");
      }

      if (method === "GET" && url.pathname === "/admin/settings") {
        const section = url.searchParams.get("section");
        return redirect(res, section ? `/?view=${encodeURIComponent(section)}` : "/");
      }

      const folderPhotosMatch = url.pathname.match(/^\/admin\/folders\/([^/]+)\/photos$/);
      if (method === "GET" && folderPhotosMatch) {
        const folder = context.folders.get(decodeURIComponent(folderPhotosMatch[1] ?? ""));
        if (!folder) {
          return sendHtml(res, 404, renderNotFoundPage(url.pathname));
        }
        return sendHtml(res, 200, renderFolderPhotosPage(context, folder.id, readFlash(url)));
      }

      if (method === "GET" && url.pathname === "/admin/folders") {
        return sendHtml(res, 200, renderFoldersPage(context, readFlash(url)));
      }

      if (method === "GET" && url.pathname === "/admin/status") {
        return redirect(res, "/?view=status");
      }

      if (method === "GET" && url.pathname === "/admin/display") {
        return sendHtml(res, 200, renderDisplaySettingsPage(context, readFlash(url)));
      }

      if (method === "POST" && url.pathname === "/admin/display/save") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        try {
          const form = await readForm(req);
          const current = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
          const folders = context.folders.list();
          const selectedFolderIds = form.useAllFolders === "on"
            ? []
            : folders.filter((folder) => form[`folder-${folder.id}`] === "on").map((folder) => folder.id);
          if (form.useAllFolders !== "on" && selectedFolderIds.length === 0) {
            return redirect(res, settingsLocation("display", "error", "Choose at least one album, or use all albums."));
          }
          const photoDurationSeconds = parseDisplayDuration(form.photoDurationSeconds, current.photoDurationSeconds);
          const imagePresentationMode = parsePresentationMode(form.imagePresentationMode, current.imagePresentationMode);
          const orderMode = parseOrderMode(form.orderMode, current.orderMode);
          const screenLayout = parseScreenLayout(form.screenLayout, current.screenLayout);
          const clockFormat = parseClockFormat(form.clockFormat, current.clockFormat);
          const clockSize = parseClockSize(form.clockSize, current.clockSize);
          context.settings.putJson<DisplaySettings>("display", {
            ...current,
            selectedFolderIds,
            photoDurationSeconds,
            imagePresentationMode,
            orderMode,
            screenLayout,
            clockEnabled: form.clockEnabled === "on",
            clockFormat,
            clockShowSeconds: form.clockShowSeconds === "on",
            clockShowDate: form.clockShowDate === "on",
            clockSize
          });
          context.events.record("info", "display.settings_saved", "Display settings saved.", {
            selectedFolderCount: selectedFolderIds.length,
            useAllFolders: selectedFolderIds.length === 0,
            photoDurationSeconds,
            imagePresentationMode,
            orderMode,
            screenLayout,
            clockEnabled: form.clockEnabled === "on"
          });
          return redirect(res, settingsLocation("display", "success", "Display settings saved."));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save display settings.";
          return redirect(res, settingsLocation("display", "error", message));
        }
      }

      if (method === "GET" && url.pathname === "/admin/schedule") {
        return sendHtml(res, 200, renderScheduleSettingsPage(context, readFlash(url)));
      }

      if (method === "POST" && url.pathname === "/admin/schedule/save") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        try {
          const form = await readForm(req);
          const dailyOnTime = parseTimeOfDay(form.dailyOnTime);
          const dailyOffTime = parseTimeOfDay(form.dailyOffTime);
          const overrideState = parseScheduleOverride(form.overrideState);
          const settings: ScheduleSettings = {
            enabled: form.enabled === "on",
            dailyOnTime,
            dailyOffTime,
            overrideState
          };
          context.settings.putJson("schedule", settings);
          context.events.record("info", "schedule.settings_saved", "Schedule settings saved.", {
            enabled: settings.enabled,
            dailyOnTime: settings.dailyOnTime,
            dailyOffTime: settings.dailyOffTime,
            overrideState: settings.overrideState
          });
          return redirect(res, settingsLocation("schedule", "success", "Schedule settings saved."));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save schedule settings.";
          return redirect(res, settingsLocation("schedule", "error", message));
        }
      }

      if (method === "POST" && url.pathname === "/admin/folders/create") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }

        const form = await readForm(req);
        const validation = validateFolderName(form.name ?? "");
        if (!validation.ok) {
          return redirect(res, settingsLocation("folders", "error", validation.error ?? "Invalid folder name."));
        }

        try {
          context.folders.create(validation.sanitizedName);
          context.events.record("info", "album.created", "Album created.", {
            name: validation.sanitizedName
          });
          return redirect(
            res,
            settingsLocation("folders", "success", `Created album “${validation.sanitizedName}”.`)
          );
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            return redirect(
              res,
              settingsLocation("folders", "error", `An album named “${validation.sanitizedName}” already exists.`)
            );
          }

          throw error;
        }
      }

      if (method === "POST" && url.pathname === "/admin/folders/rename") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }

        const form = await readForm(req);
        const validation = validateFolderName(form.name ?? "");
        if (!validation.ok) {
          return redirect(res, settingsLocation("folders", "error", validation.error ?? "Invalid album name."));
        }

        const folderId = requireFormValue(form, "id");

        try {
          const renamed = context.folders.rename(folderId, validation.sanitizedName);
          if (!renamed) {
            return redirect(res, settingsLocation("folders", "error", "Album not found."));
          }

          context.events.record("info", "album.renamed", "Album renamed.", {
            id: folderId,
            name: validation.sanitizedName
          });
          return redirect(
            res,
            settingsLocation("folders", "success", `Renamed album to “${validation.sanitizedName}”.`)
          );
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            return redirect(
              res,
              settingsLocation("folders", "error", `An album named “${validation.sanitizedName}” already exists.`)
            );
          }

          throw error;
        }
      }

      if (method === "POST" && url.pathname === "/admin/folders/delete") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }

        const form = await readForm(req);
        const folderId = requireFormValue(form, "id");
        const album = context.folders.get(folderId);
        if (!album) {
          return redirect(res, settingsLocation("folders", "error", "Album not found."));
        }
        try {
          const photos = context.photos.listByFolder(folderId);
          await Promise.all(photos.flatMap((photo) => [
            rm(resolve(context.config.paths.originalsDir, photo.storedBasename), { force: true }),
            rm(resolve(context.config.paths.thumbnailsDir, `${photo.id}.jpg`), { force: true }),
            rm(resolve(context.config.paths.displayDir, `${photo.id}.jpg`), { force: true }),
            rm(resolve(context.config.paths.blurredDir, `${photo.id}.jpg`), { force: true })
          ]));
          for (const photo of photos) {
            context.photos.delete(photo.id);
          }
          context.folders.delete(folderId);
          context.events.record("info", "album.deleted", "Album and photos deleted.", {
            id: folderId,
            name: album.name,
            photoCount: photos.length
          });
          return redirect(res, settingsLocation("folders", "success", `Deleted album “${album.name}” and ${photos.length.toString()} photo${photos.length === 1 ? "" : "s"}.`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not delete album files.";
          return redirect(res, settingsLocation("folders", "error", message));
        }
      }

      if (method === "POST" && url.pathname === "/admin/photos/check-duplicates") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        try {
          const form = await readForm(req);
          const folderId = requireFormValue(form, "folderId");
          if (!context.folders.get(folderId)) {
            return sendJson(res, 404, { status: "error", message: "Album not found." });
          }
          const filenames = JSON.parse(requireFormValue(form, "filenames"));
          if (!Array.isArray(filenames) || !filenames.every((filename) => typeof filename === "string")) {
            throw new Error("Invalid upload filenames.");
          }
          const duplicates = [...new Set(filenames)].filter((filename) => context.photos.findByOriginalFilename(folderId, filename));
          return sendJson(res, 200, { status: "ok", duplicates });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not check for duplicate photos.";
          return sendJson(res, 400, { status: "error", message });
        }
      }

      if (method === "POST" && url.pathname === "/admin/photos/upload") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        const wantsJson = prefersJson(req);
        try {
          const form = await readMultipartUpload(req, context.config.paths.tempDir);
          const folderId = requireFormValue(form.fields, "folderId");
          const folder = context.folders.get(folderId);
          if (!folder) {
            if (wantsJson) return sendJson(res, 404, { status: "error", message: "Album not found." });
            return redirect(res, `/admin/folders?error=${encodeURIComponent("Album not found.")}`);
          }
          const file = form.file;
          if (!file) {
            if (wantsJson) return sendJson(res, 400, { status: "error", message: "Choose an image to upload." });
            return redirect(res, `${folderPhotosPath(folderId)}?error=${encodeURIComponent("Choose an image to upload.")}`);
          }
          const staged = await ingestion.stageStreamed(file);
          const conflict = ingestion.findConflict(folderId, staged.originalFilename);
          const requestedConflictAction = form.fields.duplicateAction;
          if (conflict) {
            if (requestedConflictAction === "skip") {
              await ingestion.discard(staged.tempBasename);
              if (wantsJson) return sendJson(res, 200, { status: "skipped", filename: staged.originalFilename });
              return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent("Skipped the incoming photo.")}`);
            }
            if (requestedConflictAction === "keep-both" || requestedConflictAction === "replace") {
              const photo = await ingestion.commit(folderId, staged, requestedConflictAction);
              context.processor.enqueue(photo.id);
              context.events.record("info", `photo.${requestedConflictAction}`, "Resolved queued photo filename conflict.", {
                folderId,
                photoId: photo.id,
                filename: photo.originalFilename,
                action: requestedConflictAction
              });
              if (wantsJson) return sendJson(res, 201, { status: "uploaded", filename: photo.originalFilename });
              return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent(`Saved “${photo.originalFilename}”.`)}`);
            }
            if (wantsJson) return sendJson(res, 409, { status: "conflict", folderId: folder.id, tempBasename: staged.tempBasename, originalFilename: staged.originalFilename, existingFilename: conflict.originalFilename });
            return sendHtml(res, 200, renderUploadConflictPage(folder.id, folder.name, staged, conflict.originalFilename));
          }
          const photo = await ingestion.commit(folderId, staged, "keep-both");
          context.processor.enqueue(photo.id);
          context.events.record("info", "photo.uploaded", "Photo uploaded.", {
            folderId,
            photoId: photo.id,
            filename: photo.originalFilename
          });
          if (wantsJson) return sendJson(res, 201, { status: "uploaded", filename: photo.originalFilename });
          return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent(`Uploaded “${photo.originalFilename}”.`)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          if (wantsJson) return sendJson(res, 400, { status: "error", message });
          return redirect(res, `/admin/folders?error=${encodeURIComponent(message)}`);
        }
      }

      if (method === "POST" && url.pathname === "/admin/photos/confirm-upload") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        const wantsJson = prefersJson(req);
        try {
          const form = await readForm(req);
          const folderId = requireFormValue(form, "folderId");
          const tempBasename = requireFormValue(form, "tempBasename");
          const originalFilename = requireFormValue(form, "originalFilename");
          const action = requireFormValue(form, "action");
          if (action === "skip") {
            await ingestion.discard(tempBasename);
            if (wantsJson) return sendJson(res, 200, { status: "skipped", filename: originalFilename });
            return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent("Skipped the incoming photo.")}`);
          }
          if (action !== "keep-both" && action !== "replace") {
            throw new Error("Choose how to resolve the filename conflict.");
          }
          const staged = await ingestion.loadStaged(tempBasename, originalFilename);
          const photo = await ingestion.commit(folderId, staged, action);
          context.processor.enqueue(photo.id);
          context.events.record("info", `photo.${action}`, "Resolved photo filename conflict.", {
            folderId,
            photoId: photo.id,
            filename: photo.originalFilename,
            action
          });
          if (wantsJson) return sendJson(res, 201, { status: "uploaded", filename: photo.originalFilename });
          return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent(`Saved “${photo.originalFilename}”.`)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload confirmation failed.";
          if (wantsJson) return sendJson(res, 400, { status: "error", message });
          return redirect(res, `/admin/folders?error=${encodeURIComponent(message)}`);
        }
      }

      if (method === "POST" && url.pathname === "/admin/photos/rotation") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        try {
          const form = await readForm(req);
          const folderId = requireFormValue(form, "folderId");
          const photoId = requireFormValue(form, "photoId");
          const rotation = parseManualRotation(form.rotation);
          const photo = context.photos.get(photoId);
          if (!photo || photo.folderId !== folderId) {
            return redirect(res, `${folderPhotosPath(folderId)}?error=${encodeURIComponent("Photo not found.")}`);
          }
          context.photos.setManualRotation(photoId, rotation);
          context.processor.enqueue(photoId);
          context.events.record("info", "photo.rotation_saved", "Photo rotation saved.", {
            folderId,
            photoId,
            rotation
          });
          return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent("Rotation saved; display assets are refreshing.")}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save rotation.";
          return redirect(res, `/admin/folders?error=${encodeURIComponent(message)}`);
        }
      }

      if (method === "POST" && url.pathname === "/admin/photos/delete") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        try {
          const form = await readForm(req);
          const folderId = requireFormValue(form, "folderId");
          const photoId = requireFormValue(form, "photoId");
          const photo = context.photos.get(photoId);
          if (!photo || photo.folderId !== folderId) {
            return redirect(res, `${folderPhotosPath(folderId)}?error=${encodeURIComponent("Photo not found.")}`);
          }
          await Promise.all([
            rm(resolve(context.config.paths.originalsDir, photo.storedBasename), { force: true }),
            rm(resolve(context.config.paths.thumbnailsDir, `${photo.id}.jpg`), { force: true }),
            rm(resolve(context.config.paths.displayDir, `${photo.id}.jpg`), { force: true }),
            rm(resolve(context.config.paths.blurredDir, `${photo.id}.jpg`), { force: true })
          ]);
          context.photos.delete(photoId);
          context.events.record("info", "photo.deleted", "Photo deleted.", { folderId, photoId, filename: photo.originalFilename });
          return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent(`Deleted “${photo.originalFilename}”.`)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not delete photo.";
          return redirect(res, `/admin/folders?error=${encodeURIComponent(message)}`);
        }
      }

      if (method === "POST" && url.pathname === "/admin/photos/retry") {
        if (!isTrustedOrigin(req)) {
          return sendPlainText(res, 403, "Forbidden");
        }
        try {
          const form = await readForm(req);
          const folderId = requireFormValue(form, "folderId");
          const photoId = requireFormValue(form, "photoId");
          const photo = context.photos.get(photoId);
          if (!photo || photo.folderId !== folderId) {
            return redirect(res, `${folderPhotosPath(folderId)}?error=${encodeURIComponent("Photo not found.")}`);
          }
          context.photos.setProcessingStatus(photoId, "pending");
          context.processor.enqueue(photoId);
          context.events.record("info", "photo.retry_requested", "Photo processing retry requested.", { folderId, photoId });
          return redirect(res, `${folderPhotosPath(folderId)}?success=${encodeURIComponent("Photo processing retry started.")}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not retry photo processing.";
          return redirect(res, `/admin/folders?error=${encodeURIComponent(message)}`);
        }
      }

      sendHtml(res, 404, renderNotFoundPage(url.pathname));
    }
  };
}

function renderDisplayPage(settings: DisplaySettings): string {
  const durationMs = Math.max(1_000, Math.round(settings.photoDurationSeconds * 1_000));
  const presentation = settings.imagePresentationMode === "fill" ? "cover" : "contain";
  const isTriple = settings.screenLayout === "triple";
  const clockSize = { small: "1rem", medium: "1.6rem", large: "2.4rem" }[settings.clockSize] ?? "1.6rem";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Display</title>
    <style>
      :root { color-scheme: dark; background:#000; } * { box-sizing:border-box; }
      body { margin:0; overflow:hidden; background:#000; color:#fff; font-family:Georgia, serif; }
      main { position:relative; width:100vw; height:100vh; display:grid; place-items:center; background:#000; }
      #stage { position:absolute; inset:0; display:grid; grid-template-columns:1fr; gap:0; background:#000; }
      #stage.triple { grid-template-columns:repeat(3, minmax(0, 1fr)); gap:2px; }
      img { width:100%; height:100%; min-width:0; object-fit:${presentation}; opacity:0; transition:opacity 900ms ease; background:#000; }
      img.visible { opacity:1; } #empty { max-width:32rem; padding:2rem; text-align:center; color:#bdb6aa; line-height:1.6; }
      #caption { position:absolute; right:18px; bottom:14px; margin:0; max-width:60vw; color:rgba(255,255,255,.72); font-size:.85rem; text-shadow:0 1px 3px #000; opacity:0; transition:opacity .4s; }
      #caption.visible { opacity:1; }
      #clock { position:absolute; left:22px; top:18px; margin:0; color:rgba(255,255,255,.92); font-size:${clockSize}; font-variant-numeric:tabular-nums; letter-spacing:.03em; text-shadow:0 2px 5px #000; }
    </style>
  </head>
  <body>
    <main>
      <div style="position:absolute;left:20px;top:18px;z-index:2">${renderLogo(128)}</div>
      <section id="stage" class="${isTriple ? "triple" : "single"}"><img alt=""><img alt=""><img alt=""></section>
      <p id="empty">Waiting for a ready photo. Upload images from the local administration page.</p>
      <p id="caption"></p>
      ${settings.clockEnabled ? `<time id="clock"></time>` : ""}
    </main>
    <script>
      const durationMs = ${durationMs.toString()};
      const isTriple = ${isTriple ? "true" : "false"};
      const stage = document.querySelector("#stage");
      const images = Array.from(stage.querySelectorAll("img"));
      const empty = document.querySelector("#empty");
      const caption = document.querySelector("#caption");
      const clock = document.querySelector("#clock");
      let currentId = "";
      let scheduleOff = false;
      let advanceTimer = null;

      function scheduleAdvance(delay) {
        if (advanceTimer) clearTimeout(advanceTimer);
        advanceTimer = setTimeout(advance, delay);
      }

      function hideDisplay() {
        stage.hidden = true;
        empty.hidden = true;
        caption.classList.remove("visible");
      }

      function updateClock() {
        if (!clock) return;
        const date = new Date();
        const timeOptions = { hour: "numeric", minute: "2-digit"${settings.clockShowSeconds ? ', second: "2-digit"' : ""}${settings.clockFormat === "12h" ? ", hour12: true" : settings.clockFormat === "24h" ? ", hour12: false" : ""} };
        const time = new Intl.DateTimeFormat(undefined, timeOptions).format(date);
        const day = ${settings.clockShowDate ? 'new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date)' : '""'};
        clock.textContent = day ? day + "  " + time : time;
      }

      async function advance() {
        try {
          const response = await fetch("/api/display/next?after=" + encodeURIComponent(currentId), { cache: "no-store" });
          const payload = await response.json();
          if (!payload.displayOn) {
            scheduleOff = true;
            hideDisplay();
            scheduleAdvance(5000);
            return;
          }
          if (!payload.photos || payload.photos.length === 0) {
            stage.hidden = true;
            empty.hidden = false;
            scheduleAdvance(Math.min(durationMs, 5000));
            return;
          }
          const nextPhotos = payload.photos.slice(0, isTriple ? 3 : 1);
          await Promise.all(nextPhotos.map((photo) => new Promise((resolve, reject) => {
            const preloaded = new Image();
            preloaded.onload = resolve;
            preloaded.onerror = reject;
            preloaded.src = photo.src;
          })));
          stage.hidden = false;
          images.forEach((image, index) => {
            const photo = nextPhotos[index];
            if (!photo) {
              image.classList.remove("visible");
              image.removeAttribute("src");
              return;
            }
            image.src = photo.src;
            image.alt = photo.alt;
            image.classList.add("visible");
          });
          caption.textContent = nextPhotos.map((photo) => photo.alt).join(" · ");
            caption.classList.add("visible");
            empty.hidden = true;
            currentId = nextPhotos[0].id;
            scheduleAdvance(durationMs);
        } catch {
          scheduleAdvance(1000);
        }
      }
      async function pollSchedule() {
        try {
          const response = await fetch("/api/display/next", { cache: "no-store" });
          const payload = await response.json();
          if (!payload.displayOn) {
            scheduleOff = true;
            hideDisplay();
          } else if (scheduleOff) {
            scheduleOff = false;
            scheduleAdvance(0);
          }
        } catch {}
      }
      advance();
      setInterval(pollSchedule, 5000);
      updateClock();
      setInterval(updateClock, 1000);
    </script>
  </body>
</html>`;
}

function renderHomePage(context: AppContext): string {
  const stats = context.photos.stats();
  const folders = context.folders.list();
  const displaySettings = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
  const scheduleSettings = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  const displayOn = isDisplayOn(scheduleSettings, new Date());
  const activity = context.events.listRecent(4);
  const selectedFolderLabel = displaySettings.selectedFolderIds.length === 0
    ? "All albums"
    : `${displaySettings.selectedFolderIds.length.toString()} selected`;
  const libraryRows = folders.length === 0
    ? `<p class="muted">Your library is empty. Create an album to start adding photos.</p>`
    : folders.slice(0, 4).map((folder) => `<a class="library-row" href="${folderPhotosPath(folder.id)}"><span>${escapeHtml(folder.name)}</span><strong>${folder.photoCount.toString()}</strong></a>`).join("");
  const activityRows = activity.length === 0
    ? `<p class="muted">Your recent frame activity will appear here.</p>`
    : activity.map((event) => `<li><span class="event-dot ${escapeHtml(event.level)}"></span><span>${escapeHtml(event.message)}</span><time>${escapeHtml(formatTimestamp(event.createdAt))}</time></li>`).join("");
  const libraryStatus = stats.failed > 0
    ? `${stats.failed.toString()} photo${stats.failed === 1 ? "" : "s"} need attention`
    : stats.pending + stats.processing > 0
      ? "Preparing new photos"
      : stats.ready > 0 ? "Library is ready" : "No ready photos yet";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f4f5; --paper: #ffffff; --ink: #4d535c; --muted: #8b929d; --line: #dedfe2;
        --green: #0d8ca6; --orange: #bd7b30; --red: #b34b45; --shadow: 0 12px 28px rgba(43, 49, 58, .07);
      }
      * { box-sizing: border-box; } body { margin:0; color:var(--ink); font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0,#f1f2f3 100%); }
      main { max-width:1180px; min-height:100vh; margin:auto; padding:34px 20px 56px; } header { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:27px; } .brand { display:flex; align-items:center; gap:12px; } .mark { width:35px; height:35px; border-radius:50%; background:#fff; border:2px solid var(--green); box-shadow:inset 0 0 0 6px #eaf6f8; } h1 { font-size:clamp(2rem, 4vw, 3.3rem); line-height:.9; margin:0; letter-spacing:-.04em; } .eyebrow { margin:0 0 6px; color:var(--muted); font-size:.88rem; letter-spacing:.08em; text-transform:uppercase; } a { color:inherit; } .nav { display:flex; gap:13px; flex-wrap:wrap; color:var(--muted); font-size:.94rem; }
      .hero { display:grid; grid-template-columns:1.45fr .8fr; gap:18px; margin-bottom:18px; } .card { background:var(--paper); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); } .now { padding:29px; background:linear-gradient(135deg,#5a616b,#747b84); color:#fff; overflow:hidden; position:relative; } .now:after { content:""; position:absolute; width:240px; height:240px; border:1px solid rgba(255,255,255,.16); border-radius:50%; right:-90px; top:-70px; } .now p { color:rgba(255,255,255,.78); } .now h2 { position:relative; margin:9px 0 7px; font-size:clamp(2rem,4vw,3.7rem); line-height:.92; letter-spacing:-.05em; } .status { display:inline-flex; align-items:center; gap:8px; position:relative; font-size:.9rem; } .status i { width:9px; height:9px; background:${displayOn ? "#72d2df" : "#f4c884"}; border-radius:50%; box-shadow:0 0 0 5px rgba(255,255,255,.13); } .actions { position:relative; display:flex; gap:10px; margin-top:22px; flex-wrap:wrap; } .button { display:inline-block; border-radius:5px; padding:10px 15px; text-decoration:none; background:#fff; color:#32717f; font-size:.94rem; } .button.ghost { color:#fff; background:rgba(0,0,0,.1); border:1px solid rgba(255,255,255,.22); }
      .snapshot { padding:24px; display:grid; align-content:center; } .snapshot h2,.section-title { margin:0; font-size:1.25rem; } .snapshot dl { margin:19px 0 0; display:grid; gap:14px; } .snapshot dl div { display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid var(--line); padding-bottom:11px; } dt { color:var(--muted); } dd { margin:0; font-weight:700; text-align:right; } .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:${displayOn ? "var(--green)" : "var(--orange)"}; margin-right:6px; }
      .grid { display:grid; grid-template-columns:1.1fr .9fr .9fr; gap:18px; } .panel { padding:22px; } .panel-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:16px; } .panel-head a { color:var(--green); font-size:.9rem; } .stat { font-size:2.8rem; line-height:1; letter-spacing:-.06em; margin:16px 0 4px; } .muted { color:var(--muted); line-height:1.5; } .health { display:flex; gap:7px; margin:20px 0 6px; } .health span { flex:1; height:8px; border-radius:20px; background:#e6ddd0; } .health .ready { background:var(--green); } .health .waiting { background:var(--orange); } .health .failed { background:var(--red); } .library-row { display:flex; justify-content:space-between; gap:12px; padding:12px 0; border-bottom:1px solid var(--line); text-decoration:none; } .library-row:last-child { border:0; } .library-row strong { color:var(--green); } .activity { list-style:none; padding:0; margin:0; display:grid; gap:13px; } .activity li { display:grid; grid-template-columns:auto 1fr auto; gap:8px; align-items:start; font-size:.92rem; } .activity time { color:var(--muted); font-size:.78rem; white-space:nowrap; } .event-dot { width:8px; height:8px; margin-top:5px; border-radius:50%; background:var(--green); } .event-dot.warning { background:var(--orange); } .event-dot.error { background:var(--red); }
      @media (max-width:850px) { .hero,.grid { grid-template-columns:1fr; } } @media (max-width:540px) { main { padding:24px 14px 40px; } header { align-items:flex-start; flex-direction:column; } .activity li { grid-template-columns:auto 1fr; } .activity time { grid-column:2; } }
    </style>
  </head>
  <body>
    <main>
      <header><div class="brand">${renderLogo(176)}<p class="eyebrow">Your living room frame</p></div></header>
      <section class="hero"><section class="card now"><span class="status"><i></i>${displayOn ? "Displaying now" : "Display is off"}</span><h2>${displayOn ? stats.ready > 0 ? "Your frame is on." : "Waiting for photos." : "Resting quietly."}</h2><p>${displayOn ? stats.ready > 0 ? `${stats.ready.toString()} ready photo${stats.ready === 1 ? "" : "s"} are available for display.` : "Upload a photo to begin the slideshow." : "The schedule or an override has set the display to black."}</p><div class="actions"><a class="button" href="/display">Open frame</a><a class="button ghost" href="/admin/settings">Settings</a></div></section><section class="card snapshot"><h2>Frame setup</h2><dl><div><dt>Source</dt><dd>${escapeHtml(selectedFolderLabel)}</dd></div><div><dt>Layout</dt><dd>${displaySettings.screenLayout === "triple" ? "Three photos" : "One photo"}</dd></div><div><dt>Change every</dt><dd>${displaySettings.photoDurationSeconds.toString()} seconds</dd></div><div><dt>Schedule</dt><dd><span class="dot"></span>${displayOn ? "On" : "Off"}</dd></div></dl></section></section>
      <section class="grid"><section class="card panel"><div class="panel-head"><h2 class="section-title">Library health</h2><a href="/admin/settings?section=folders">View library</a></div><div class="stat">${stats.total.toString()}</div><p class="muted">${libraryStatus}</p><div class="health"><span class="ready" style="flex:${Math.max(stats.ready, 1).toString()}"></span><span class="waiting" style="flex:${Math.max(stats.pending + stats.processing, 1).toString()}"></span><span class="failed" style="flex:${Math.max(stats.failed, 1).toString()}"></span></div><p class="muted">${stats.ready.toString()} ready · ${(stats.pending + stats.processing).toString()} preparing · ${stats.failed.toString()} failed</p></section><section class="card panel"><div class="panel-head"><h2 class="section-title">Albums</h2><a href="/admin/settings?section=folders">Edit</a></div>${libraryRows}</section><section class="card panel"><div class="panel-head"><h2 class="section-title">Recent activity</h2><a href="/admin/status">Status</a></div><ul class="activity">${activityRows}</ul></section></section>
    </main>
  </body>
</html>`;
}

function renderSettingsPage(context: AppContext, flash: FlashMessage, requestedSection: string | null): string {
  const validSections = ["dashboard", "general", "display", "schedule", "folders", "status"] as const;
  const activeSection = validSections.includes(requestedSection as typeof validSections[number]) ? requestedSection as typeof validSections[number] : "dashboard";
  const sectionLabel = (section: typeof validSections[number]): string => {
    if (section === "folders") return "Albums";
    if (section === "status") return "System Status";
    return `${section[0]?.toUpperCase()}${section.slice(1)}`;
  };
  const display = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
  const schedule = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  const folders = context.folders.list();
  const stats = context.photos.stats();
  const events = context.events.listRecent(8);
  const displayOn = isDisplayOn(schedule, new Date());
  const allFolders = display.selectedFolderIds.length === 0;
  const folderChecks = folders.length === 0
    ? `<p class="muted">Create an album before choosing specific display albums.</p>`
    : folders.map((folder) => `<label class="check"><input type="checkbox" name="folder-${escapeHtml(folder.id)}"${display.selectedFolderIds.includes(folder.id) ? " checked" : ""}> ${escapeHtml(folder.name)} <small>${folder.photoCount.toString()} photos</small></label>`).join("");
  const folderList = `<div class="album-table-wrap"><table class="album-table"><colgroup><col class="album-name-column"><col class="album-count-column"><col><col class="album-action-column"><col class="album-delete-column"></colgroup><tbody>${folders.map((folder) => { const renameFormId = `rename-album-${folder.id}`; const renameButtonId = `${renameFormId}-submit`; return `<tr><td><a class="album-name" href="${folderPhotosPath(folder.id)}"><span>${escapeHtml(folder.name)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5"/></svg></a></td><td class="album-count">${folder.photoCount.toString()} photos</td><td><form id="${renameFormId}" class="album-rename" method="post" action="/admin/folders/rename"><input type="hidden" name="id" value="${escapeHtml(folder.id)}"><input type="text" name="name" value="${escapeHtml(folder.name)}" maxlength="120" aria-label="Rename ${escapeHtml(folder.name)}" oninput="document.getElementById('${renameButtonId}').disabled = this.value === this.defaultValue" required></form></td><td><button id="${renameButtonId}" class="album-action" type="submit" form="${renameFormId}" disabled>Rename</button></td><td><form class="album-delete" method="post" action="/admin/folders/delete"><input type="hidden" name="id" value="${escapeHtml(folder.id)}"><button type="submit" aria-label="Delete ${escapeHtml(folder.name)}" title="Delete album" onclick="return confirm('Delete this album and all of its photos?') && confirm('This cannot be undone. Are you absolutely sure you want to delete this entire album?');"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13"/></svg></button></form></td></tr>`; }).join("")}<tr class="album-create"><td><span class="album-new-name">New Album</span></td><td class="album-count">0 photos</td><td><form id="create-album" method="post" action="/admin/folders/create"><input type="text" name="name" maxlength="120" placeholder="Enter new album name" aria-label="New album name" required></form></td><td><button class="album-action" type="submit" form="create-album">Create</button></td><td></td></tr></tbody></table></div>`;
  const eventRows = events.length === 0
    ? `<p class="muted">No recent activity.</p>`
    : `<ul class="event-list">${events.map((event) => `<li><strong>${escapeHtml(event.level.toUpperCase())}</strong><span>${escapeHtml(event.message)}</span><time>${escapeHtml(formatTimestamp(event.createdAt))}</time></li>`).join("")}</ul>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Settings - PiFrame</title>
    <style>
      :root { --bg:#f3f4f5; --rail:#ffffff; --paper:#ffffff; --ink:#4d535c; --muted:#9097a1; --line:#dedfe2; --accent:#0d8ca6; --success:#157b6d; --success-bg:#e4f4f2; --error:#af4844; --error-bg:#f9e7e6; } * { box-sizing:border-box; } body { margin:0; color:var(--ink); font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0,var(--bg) 100%); } main { min-height:100vh; display:grid; grid-template-columns:250px minmax(0,1fr); } aside { padding:28px 18px; background:var(--rail); color:var(--ink); border-right:1px solid var(--line); } .brand { display:flex; gap:10px; align-items:center; margin:0 8px 36px; } .mark { width:28px; height:28px; border-radius:50%; background:#fff; border:2px solid var(--accent); box-shadow:inset 0 0 0 5px #e9f7f9; } h1 { margin:0; font-size:1.6rem; letter-spacing:-.04em; } .brand p { margin:0; color:var(--muted); font-size:.8rem; } nav { display:grid; gap:2px; } nav button { border:0; border-left:3px solid transparent; padding:12px 13px; text-align:left; border-radius:0 7px 7px 0; color:#747b85; background:transparent; font:inherit; cursor:pointer; } nav button.active,nav button:hover { color:var(--accent); background:#eff8fa; border-left-color:var(--accent); } .rail-footer { margin:32px 8px 0; display:grid; gap:10px; font-size:.88rem; } .rail-footer a { color:#747b85; }
      .content { max-width:1020px; width:100%; padding:34px clamp(20px,5vw,60px) 58px; } .top { display:flex; align-items:end; justify-content:space-between; gap:15px; margin-bottom:25px; } .top h2 { margin:0; font-size:clamp(2rem,4vw,3rem); letter-spacing:-.05em; } .top p,.muted { color:var(--muted); line-height:1.55; } .panel[hidden] { display:none; } .card { padding:24px; background:var(--paper); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 20px rgba(43,49,58,.05); } .flash { padding:14px 16px; border-radius:8px; margin-bottom:18px; } .flash.success { color:var(--success); background:var(--success-bg); } .flash.error { color:var(--error); background:var(--error-bg); } h3 { margin:0 0 9px; font-size:1.2rem; } form { display:grid; gap:22px; } .section { display:grid; gap:11px; padding-bottom:22px; border-bottom:1px solid var(--line); } .section:last-of-type { border:0; padding-bottom:0; } label { font-weight:700; } .field { display:grid; gap:7px; max-width:370px; } input[type=text],input[type=number],input[type=time],select { width:100%; padding:10px 12px; background:#fff; border:1px solid #cdd0d4; border-radius:6px; font:inherit; } button.save { justify-self:start; border:0; padding:10px 17px; border-radius:5px; color:#fff; background:var(--accent); font:inherit; cursor:pointer; } .folders { display:grid; gap:8px; padding:14px; border:1px solid var(--line); border-radius:8px; max-width:500px; } .check { font-weight:400; } small { color:var(--muted); } .times { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:13px; max-width:500px; } .stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; } .stat { padding:18px; border-radius:8px; background:#f5f6f7; } .stat strong { display:block; font-size:2.15rem; line-height:1; } .album-table-wrap { max-width:760px; overflow-x:auto; } .album-table { width:100%; min-width:650px; border-collapse:collapse; table-layout:fixed; } .album-name-column { width:34%; } .album-count-column { width:13%; } .album-action-column { width:88px; } .album-delete-column { width:48px; } .album-table td { padding:11px 10px 11px 0; border-bottom:1px solid var(--line); vertical-align:middle; } .album-table td:last-child { padding-right:0; } .album-table tr:last-child td { border-bottom:0; } .album-name { display:inline-flex; align-items:center; gap:5px; color:var(--accent); text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; overflow-wrap:anywhere; } .album-name:hover { color:#087287; } .album-name svg { width:15px; height:15px; flex:0 0 auto; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; } .album-new-name { color:var(--ink); } .album-count { color:var(--muted); font-size:.9rem; white-space:nowrap; } .album-rename { display:block; } .album-rename input,.album-create input { min-width:0; padding:7px 8px; } .album-action { border:0; border-radius:5px; padding:8px 10px; background:#eef0f2; color:var(--ink); font:inherit; cursor:pointer; white-space:nowrap; } .album-action:disabled { color:#aeb3ba; background:#f4f5f6; cursor:not-allowed; } .album-create .album-action { color:#fff; background:var(--accent); } .album-delete { display:block; } .album-delete button { display:grid; place-items:center; width:34px; height:34px; padding:0; border:0; border-radius:5px; color:#a0a5ab; background:transparent; cursor:pointer; } .album-delete button:hover,.album-delete button:focus-visible { color:var(--error); background:var(--error-bg); } .album-delete svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; } .dashboard-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; } .dashboard-lead { color:#fff; background:linear-gradient(135deg,#5a616b,#747b84); } .dashboard-lead p { color:rgba(255,255,255,.78); } .dashboard-lead h3 { font-size:2rem; letter-spacing:-.04em; } .dashboard-actions { display:flex; gap:10px; margin-top:20px; } .dashboard-actions a { padding:9px 14px; border-radius:5px; text-decoration:none; background:#fff; color:var(--accent); } .dashboard-actions a.secondary { color:#fff; background:rgba(0,0,0,.12); border:1px solid rgba(255,255,255,.2); } .event-list { display:grid; gap:10px; padding:0; margin:0; list-style:none; } .event-list li { display:grid; grid-template-columns:max-content 1fr max-content; gap:8px; align-items:baseline; padding-bottom:10px; border-bottom:1px solid var(--line); font-size:.9rem; } .event-list strong { color:var(--accent); font-size:.75rem; } .event-list time { color:var(--muted); font-size:.78rem; } dialog { border:1px solid var(--line); border-radius:12px; color:var(--ink); box-shadow:0 20px 70px rgba(0,0,0,.2); max-width:430px; padding:0; } dialog::backdrop { background:rgba(35,40,46,.34); } .about { padding:25px; } .about p { color:var(--muted); line-height:1.55; } .about button { border:0; border-radius:5px; padding:9px 14px; color:#fff; background:var(--accent); font:inherit; cursor:pointer; } @media (max-width:720px) { main { grid-template-columns:1fr; } aside { padding:17px; } .brand { margin:0 0 15px; } nav { grid-template-columns:repeat(6,1fr); overflow:auto; } .rail-footer { display:none; } .content { padding:26px 17px 44px; } .times,.stats,.dashboard-grid { grid-template-columns:1fr; } .event-list li { grid-template-columns:max-content 1fr; } .event-list time { grid-column:2; } }
    </style>
  </head>
  <body><main>
    <aside><div class="brand">${renderLogo(156)}</div><nav>${validSections.map((section) => `<button type="button" data-section="${section}"${section === activeSection ? " class=\"active\"" : ""}>${sectionLabel(section)}</button>`).join("")}</nav><div class="rail-footer"><a href="/display">Open frame</a></div></aside>
    <section class="content"><header class="top"><div><p class="muted">PiFrame Administration</p><h2 id="section-title">${sectionLabel(activeSection)}</h2></div></header>${renderFlash(flash)}
      <section class="panel" data-panel="dashboard"${activeSection === "dashboard" ? "" : " hidden"}><div class="dashboard-grid"><section class="card dashboard-lead"><p>${displayOn ? "Displaying now" : "Display is off"}</p><h3>${displayOn ? stats.ready > 0 ? "Your frame is on." : "Waiting for photos." : "Resting quietly."}</h3><p>${displayOn ? `${stats.ready.toString()} ready photo${stats.ready === 1 ? "" : "s"} are available for display.` : "The schedule or an override has set the display to black."}</p><div class="dashboard-actions"><a href="/display">Open frame</a><a class="secondary" href="/?view=folders">Manage albums</a></div></section><section class="card"><h3>Frame setup</h3><dl><div><dt>Source</dt><dd>${display.selectedFolderIds.length === 0 ? "All albums" : `${display.selectedFolderIds.length.toString()} selected`}</dd></div><div><dt>Layout</dt><dd>${display.screenLayout === "triple" ? "Three photos" : "One photo"}</dd></div><div><dt>Change every</dt><dd>${display.photoDurationSeconds.toString()} seconds</dd></div><div><dt>Schedule</dt><dd>${displayOn ? "On" : "Off"}</dd></div></dl></section></div><section class="card" style="margin-top:16px"><h3>Library health</h3><div class="stats"><div class="stat"><strong>${stats.total.toString()}</strong><span>Photos</span></div><div class="stat"><strong>${stats.ready.toString()}</strong><span>Ready</span></div><div class="stat"><strong>${(stats.pending + stats.processing + stats.failed).toString()}</strong><span>Need attention</span></div></div></section></section>
      <section class="panel" data-panel="general"${activeSection === "general" ? "" : " hidden"}><div class="card"><h3>Frame overview</h3><p class="muted">Your frame is running locally at <code>${escapeHtml(context.config.host)}:${context.config.port.toString()}</code>.</p><div class="stats"><div class="stat"><strong>${stats.total.toString()}</strong><span>Photos</span></div><div class="stat"><strong>${stats.ready.toString()}</strong><span>Ready to display</span></div><div class="stat"><strong>${(stats.pending + stats.processing + stats.failed).toString()}</strong><span>Need attention</span></div></div><p class="muted">Use the sections on the left to select display content, tune playback, set daily hours, and organize albums.</p></div></section>
      <section class="panel" data-panel="display"${activeSection === "display" ? "" : " hidden"}><div class="card"><form method="post" action="/admin/display/save"><section class="section"><h3>Photo source</h3><label><input id="all-folders" type="checkbox" name="useAllFolders"${allFolders ? " checked" : ""}> Use all albums</label><div id="folder-choices" class="folders">${folderChecks}</div></section><section class="section"><h3>Playback</h3><label class="field">Seconds per photo<input type="number" name="photoDurationSeconds" min="3" max="3600" value="${display.photoDurationSeconds.toString()}" required></label><label class="field">Ordering<select name="orderMode"><option value="random"${display.orderMode === "random" ? " selected" : ""}>Random</option><option value="filename-asc"${display.orderMode === "filename-asc" ? " selected" : ""}>Filename A-Z</option><option value="filename-desc"${display.orderMode === "filename-desc" ? " selected" : ""}>Filename Z-A</option><option value="upload-newest"${display.orderMode === "upload-newest" ? " selected" : ""}>Newest upload first</option><option value="upload-oldest"${display.orderMode === "upload-oldest" ? " selected" : ""}>Oldest upload first</option></select></label><label class="field">Layout<select name="screenLayout"><option value="single"${display.screenLayout === "single" ? " selected" : ""}>One photo</option><option value="triple"${display.screenLayout === "triple" ? " selected" : ""}>Three photos</option></select></label></section><section class="section"><h3>Appearance</h3><label class="field">Image sizing<select name="imagePresentationMode"><option value="fit"${display.imagePresentationMode !== "fill" ? " selected" : ""}>Fit entire photo</option><option value="fill"${display.imagePresentationMode === "fill" ? " selected" : ""}>Fill screen and crop edges</option></select></label><label><input type="checkbox" name="clockEnabled"${display.clockEnabled ? " checked" : ""}> Show clock</label><label class="field">Clock format<select name="clockFormat"><option value="locale-default"${display.clockFormat === "locale-default" ? " selected" : ""}>Device default</option><option value="12h"${display.clockFormat === "12h" ? " selected" : ""}>12-hour</option><option value="24h"${display.clockFormat === "24h" ? " selected" : ""}>24-hour</option></select></label><label class="field">Clock size<select name="clockSize"><option value="small"${display.clockSize === "small" ? " selected" : ""}>Small</option><option value="medium"${display.clockSize === "medium" ? " selected" : ""}>Medium</option><option value="large"${display.clockSize === "large" ? " selected" : ""}>Large</option></select></label><label><input type="checkbox" name="clockShowDate"${display.clockShowDate ? " checked" : ""}> Show date</label><label><input type="checkbox" name="clockShowSeconds"${display.clockShowSeconds ? " checked" : ""}> Show seconds</label></section><button class="save" type="submit">Save display settings</button></form></div></section>
      <section class="panel" data-panel="schedule"${activeSection === "schedule" ? "" : " hidden"}><div class="card"><form method="post" action="/admin/schedule/save"><section class="section"><h3>Daily display schedule</h3><p class="muted">Off time uses a black screen. The schedule follows the frame's local time.</p><label><input type="checkbox" name="enabled"${schedule.enabled ? " checked" : ""}> Follow a daily schedule</label><div class="times"><label class="field">Turn on<input type="time" name="dailyOnTime" value="${escapeHtml(schedule.dailyOnTime)}" required></label><label class="field">Turn off<input type="time" name="dailyOffTime" value="${escapeHtml(schedule.dailyOffTime)}" required></label></div></section><section class="section"><label class="field">Override<select name="overrideState"><option value="follow-schedule"${schedule.overrideState === "follow-schedule" ? " selected" : ""}>Follow schedule</option><option value="force-on"${schedule.overrideState === "force-on" ? " selected" : ""}>Force frame on</option><option value="force-off"${schedule.overrideState === "force-off" ? " selected" : ""}>Force frame off</option></select></label></section><button class="save" type="submit">Save schedule</button></form></div></section>
      <section class="panel" data-panel="folders"${activeSection === "folders" ? "" : " hidden"}><div class="card"><section><h3>Albums</h3><div class="folder-list">${folderList}</div></section></div></section>
      <section class="panel" data-panel="status"${activeSection === "status" ? "" : " hidden"}><div class="dashboard-grid"><section class="card"><h3>System</h3><dl><div><dt>Platform</dt><dd><code>${escapeHtml(context.config.platform)}</code></dd></div><div><dt>Host</dt><dd><code>${escapeHtml(context.config.host)}:${context.config.port.toString()}</code></dd></div><div><dt>Data root</dt><dd><code>${escapeHtml(context.config.paths.dataRoot)}</code></dd></div><div><dt>Database</dt><dd><code>${escapeHtml(context.config.paths.databaseFile)}</code></dd></div></dl></section><section class="card"><h3>Storage</h3><dl><div><dt>Originals</dt><dd><code>${escapeHtml(context.config.paths.originalsDir)}</code></dd></div><div><dt>Thumbnails</dt><dd><code>${escapeHtml(context.config.paths.thumbnailsDir)}</code></dd></div><div><dt>Display assets</dt><dd><code>${escapeHtml(context.config.paths.displayDir)}</code></dd></div></dl></section></div><section class="card" style="margin-top:16px"><h3>Recent activity</h3>${eventRows}</section></section>
    </section>
    <dialog id="about-dialog"><section class="about">${renderLogo(180)}<h3 style="margin-top:22px">About PiFrame</h3><p>PiFrame is a local-first digital picture frame for Raspberry Pi and desktop development. It stores albums and photos locally, prepares display-ready assets, and runs without a cloud service.</p><p><strong>Version 0.1.0</strong><br>Node.js, TypeScript, SQLite, and Chromium kiosk mode.</p><button id="about-close" type="button">Close</button></section></dialog>
    <script>
      const buttons = document.querySelectorAll("[data-section]"); const panels = document.querySelectorAll("[data-panel]"); const title = document.querySelector("#section-title"); const allFolders = document.querySelector("#all-folders"); const folderChoices = document.querySelector("#folder-choices"); const about = document.querySelector("#about-dialog"); const labels = { dashboard: "Dashboard", general: "General", display: "Display", schedule: "Schedule", folders: "Albums", status: "System Status" };
      function selectSection(section) { buttons.forEach((button) => button.classList.toggle("active", button.dataset.section === section)); panels.forEach((panel) => panel.hidden = panel.dataset.panel !== section); title.textContent = labels[section] || section; history.replaceState(null, "", "/?view=" + section); }
      buttons.forEach((button) => button.addEventListener("click", () => selectSection(button.dataset.section)));
      function syncFolders() { if (!allFolders || !folderChoices) return; folderChoices.style.opacity = allFolders.checked ? ".5" : "1"; folderChoices.querySelectorAll("input").forEach((input) => input.disabled = allFolders.checked); } if (allFolders) { allFolders.addEventListener("change", syncFolders); syncFolders(); }
      document.querySelectorAll(".piframe-logo").forEach((logo) => logo.addEventListener("click", (event) => { event.preventDefault(); about.showModal(); })); document.querySelector("#about-close").addEventListener("click", () => about.close()); if (new URLSearchParams(location.search).has("about")) about.showModal();
    </script>
  </main></body>
</html>`;
}

function renderFoldersPage(context: AppContext, flash: FlashMessage): string {
  const folders = context.folders.list();
  const folderRows = folders.length === 0
    ? `<tr><td colspan="4" class="empty">No albums yet. Create the first one below.</td></tr>`
    : folders
        .map((folder) => {
          return `<tr>
  <td><a href="${folderPhotosPath(folder.id)}">${escapeHtml(folder.name)}</a></td>
  <td>${folder.photoCount.toString()}</td>
  <td><time datetime="${escapeHtml(folder.updatedAt)}">${escapeHtml(formatTimestamp(folder.updatedAt))}</time></td>
  <td>
    <form method="post" action="/admin/folders/rename" class="inline-form">
      <input type="hidden" name="id" value="${escapeHtml(folder.id)}">
      <input type="text" name="name" value="${escapeHtml(folder.name)}" maxlength="120" required>
      <button type="submit">Save</button>
    </form>
    <form method="post" action="/admin/folders/delete" class="inline-form">
      <input type="hidden" name="id" value="${escapeHtml(folder.id)}">
      <button type="submit" class="danger" onclick="return confirm('Delete this album and all of its photos?') && confirm('This cannot be undone. Are you absolutely sure you want to delete this entire album?');">Delete</button>
    </form>
  </td>
</tr>`;
        })
        .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Admin</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f4f5;
        --panel: #ffffff;
        --ink: #4d535c;
        --muted: #9097a1;
        --line: #dedfe2;
        --accent: #0d8ca6;
        --danger: #af4844;
        --success-bg: #e4f4f2;
        --success-ink: #157b6d;
        --error-bg: #f9e7e6;
        --error-ink: #af4844;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #fafafa 0%, var(--bg) 100%);
      }

      .shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 28px 18px 48px;
      }

      header {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 24px;
      }

      h1, h2 {
        margin: 0;
      }

      p {
        color: var(--muted);
        line-height: 1.6;
      }

      .grid {
        display: grid;
        gap: 20px;
        grid-template-columns: 1.1fr 0.9fr;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 22px;
        box-shadow: 0 8px 20px rgba(43, 49, 58, 0.05);
      }

      .flash {
        border-radius: 14px;
        padding: 14px 16px;
        margin-bottom: 18px;
      }

      .flash.success {
        background: var(--success-bg);
        color: var(--success-ink);
      }

      .flash.error {
        background: var(--error-bg);
        color: var(--error-ink);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        text-align: left;
        border-bottom: 1px solid var(--line);
        padding: 14px 0;
        vertical-align: top;
      }

      th {
        font-size: 0.92rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .empty {
        color: var(--muted);
        padding: 26px 0;
      }

      form {
        margin: 0;
      }

      .stack {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 8px;
        font-weight: 700;
      }

      input[type="text"] {
        width: 100%;
        padding: 11px 12px;
        border: 1px solid #cdd0d4;
        border-radius: 6px;
        font: inherit;
        background: rgba(255,255,255,0.86);
      }

      button {
        border: 0;
        border-radius: 5px;
        padding: 10px 16px;
        font: inherit;
        background: var(--accent);
        color: white;
        cursor: pointer;
      }

      button.danger {
        background: var(--danger);
      }

      .inline-form {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        margin: 0 10px 10px 0;
      }

      .inline-form input[type="text"] {
        min-width: 220px;
      }

      .meta-list {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 10px 14px;
      }

      .meta-list dt {
        font-weight: 700;
      }

      code {
        font-family: "SFMono-Regular", Menlo, monospace;
        font-size: 0.95em;
      }

      @media (max-width: 840px) {
        .grid {
          grid-template-columns: 1fr;
        }

        .inline-form {
          display: grid;
          grid-template-columns: 1fr;
          justify-items: start;
        }

        .inline-form input[type="text"] {
          min-width: 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        ${renderLogo(142)}
        <div>
          <p>PiFrame Administration</p>
          <h1>Albums</h1>
        </div>
        <p><a href="/admin/display">Display settings</a> · <a href="/admin/schedule">Schedule</a> · <a href="/admin/status">View status</a></p>
      </header>
      ${renderFlash(flash)}
      <section class="grid">
        <section class="panel">
          <h2>Albums</h2>
          <p>Create the albums that organize uploads and display selection.</p>
          <table>
            <thead>
              <tr>
                <th>Album</th>
                <th>Photos</th>
                <th>Last updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${folderRows}
            </tbody>
          </table>
        </section>
        <section class="stack">
          <section class="panel">
            <h2>Create album</h2>
            <p>Album names are sanitized before persistence and must be unique.</p>
            <form method="post" action="/admin/folders/create" class="stack">
              <label>
                Album name
                <input type="text" name="name" maxlength="120" required>
              </label>
              <div>
                <button type="submit">Save album</button>
              </div>
            </form>
          </section>
          <section class="panel">
            <h2>System snapshot</h2>
            <dl class="meta-list">
              <dt>Platform</dt>
              <dd><code>${escapeHtml(context.config.platform)}</code></dd>
              <dt>Data root</dt>
              <dd><code>${escapeHtml(context.config.paths.dataRoot)}</code></dd>
              <dt>Database</dt>
              <dd><code>${escapeHtml(context.config.paths.databaseFile)}</code></dd>
              <dt>Managed originals</dt>
              <dd><code>${escapeHtml(context.config.paths.originalsDir)}</code></dd>
              <dt>Album count</dt>
              <dd>${folders.length.toString()}</dd>
            </dl>
          </section>
        </section>
      </section>
    </main>
  </body>
</html>`;
}

function renderFolderPhotosPage(context: AppContext, folderId: string, flash: FlashMessage): string {
  const folder = context.folders.get(folderId);
  if (!folder) {
    return renderNotFoundPage("/admin/folders");
  }
  const photos = context.photos.listByFolder(folderId);
  const photoRows = photos.length === 0
    ? `<tr><td colspan="4" class="empty">No photos in this album yet.</td></tr>`
    : photos.map((photo) => {
      const displayName = photo.originalFilename.length > 20 ? `${photo.originalFilename.slice(0, 19)}...` : photo.originalFilename;
      const nameState = photo.processingStatus === "failed" ? " photo-failed" : photo.processingStatus === "ready" ? "" : " photo-processing";
      const nameTitle = photo.processingError ? `${photo.originalFilename}\nProcessing error: ${photo.processingError}` : photo.originalFilename;
      const rotateLeft = (photo.manualRotationDegrees + 270) % 360;
      const rotateRight = (photo.manualRotationDegrees + 90) % 360;
      return `<tr>
  <td><div class="photo-name${nameState}">${photo.processingStatus === "ready" ? `<img src="/media/thumbnail/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" alt="">` : ""}<span title="${escapeHtml(nameTitle)}">${escapeHtml(displayName)}</span></div></td>
  <td>${photo.widthPx && photo.heightPx ? `${photo.widthPx.toString()} x ${photo.heightPx.toString()}` : "Unknown"}</td>
  <td>${formatBytes(photo.fileSizeBytes)}</td>
  <td><div class="photo-actions">${photo.processingStatus === "failed" ? `<form method="post" action="/admin/photos/retry"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><button type="submit" aria-label="Retry ${escapeHtml(photo.originalFilename)}" title="Retry processing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5m-2-5V5m0 6h-6"/></svg></button></form>` : ""}<form method="post" action="/admin/photos/rotation"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><input type="hidden" name="rotation" value="${rotateLeft.toString()}"><button type="submit" aria-label="Rotate ${escapeHtml(photo.originalFilename)} left" title="Rotate left"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg></button></form><form method="post" action="/admin/photos/rotation"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><input type="hidden" name="rotation" value="${rotateRight.toString()}"><button type="submit" aria-label="Rotate ${escapeHtml(photo.originalFilename)} right" title="Rotate right"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg></button></form><form method="post" action="/admin/photos/delete" class="delete-form"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><button type="submit" aria-label="Delete ${escapeHtml(photo.originalFilename)}" title="Delete photo" onclick="return confirm('Delete this photo and its managed files?');"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13"/></svg></button></form></div></td>
</tr>`;
    }).join("\n");
  const photoGrid = photos.length === 0
    ? `<p class="empty">No photos in this album yet.</p>`
    : `<div class="photo-grid">${photos.map((photo) => `<article class="photo-tile">${photo.processingStatus === "ready" ? `<img src="/media/thumbnail/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" alt="${escapeHtml(photo.originalFilename)}">` : `<div class="photo-placeholder">${escapeHtml(photo.processingStatus)}</div>`}<p title="${escapeHtml(photo.originalFilename)}">${escapeHtml(photo.originalFilename)}</p></article>`).join("")}</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(folder.name)} photos - PiFrame</title>
    <style>
      :root { --bg:#f3f4f5; --rail:#fff; --paper:#fff; --ink:#4d535c; --muted:#9097a1; --line:#dedfe2; --accent:#0d8ca6; --error:#af4844; --error-bg:#f9e7e6; --success:#157b6d; --success-bg:#e4f4f2; } * { box-sizing:border-box; } body { margin:0; font-family:Georgia, "Times New Roman", serif; color:var(--ink); background:linear-gradient(180deg,#fafafa 0%,var(--bg) 100%); } main { min-height:100vh; display:grid; grid-template-columns:250px minmax(0,1fr); } aside { padding:28px 18px; background:var(--rail); border-right:1px solid var(--line); } .brand { margin:0 8px 36px; } nav { display:grid; gap:2px; } nav a { display:block; padding:12px 13px; border-left:3px solid transparent; border-radius:0 7px 7px 0; color:#747b85; text-decoration:none; } nav a:hover { color:var(--accent); background:#eff8fa; } nav a.album-nested { color:#4c8190; background:#f2f8f9; border-left-color:#85c4d0; } nav a small { display:block; margin-top:3px; color:#7ca3ab; font-size:.76rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .rail-footer { margin:32px 8px 0; } .rail-footer a { color:#747b85; font-size:.88rem; } .content { max-width:1100px; width:100%; padding:34px clamp(20px,5vw,60px) 58px; } .top { display:flex; justify-content:space-between; align-items:end; gap:18px; flex-wrap:wrap; margin-bottom:25px; } .eyebrow,p { color:var(--muted); line-height:1.55; } h1,h2,h3,p { margin-top:0; } h1 { margin-bottom:0; font-size:clamp(2rem,4vw,3rem); letter-spacing:-.05em; } h2 { margin-bottom:8px; } .back-link { color:var(--accent); } .panel { padding:22px 24px; background:var(--paper); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 20px rgba(43,49,58,.05); } .flash { padding:14px 16px; border-radius:8px; margin-bottom:18px; } .flash.success { color:var(--success); background:var(--success-bg); } .flash.error { color:var(--error); background:var(--error-bg); } .upload-form { display:grid; grid-template-columns:minmax(220px,auto) auto minmax(0,1fr); align-items:center; gap:12px; } input[type=file],select { min-width:0; padding:9px 10px; border:1px solid #cdd0d4; border-radius:6px; background:#fff; font:inherit; } .upload-form button { border:0; border-radius:5px; padding:9px 14px; color:#fff; background:var(--accent); font:inherit; cursor:pointer; white-space:nowrap; } .upload-help { margin:0; font-size:.9rem; } .upload-queue { display:grid; gap:0; max-width:760px; padding:0; margin:16px 0 0; border-top:1px solid var(--line); list-style:none; } .upload-queue li { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 2px; border-bottom:1px solid var(--line); font-size:.9rem; } .upload-file { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .upload-state { flex:0 0 auto; color:var(--muted); } .upload-state.uploaded,.upload-state.skipped { color:var(--success); } .upload-state.error { color:var(--error); } .upload-choice { display:inline-flex; gap:6px; align-items:center; } .upload-choice button { padding:5px 8px; color:var(--ink); background:#eef0f2; } .upload-choice button:last-child { color:var(--error); background:var(--error-bg); } .photos-panel { margin-top:18px; } .photos-head { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; } .photos-head h2 { margin:0; } .view-switch { display:flex; gap:4px; padding:4px; background:#f1f3f4; border-radius:7px; } .view-switch button { border:0; border-radius:5px; padding:7px 11px; color:#6e757d; background:transparent; font:inherit; cursor:pointer; } .view-switch button.active { color:var(--accent); background:#fff; box-shadow:0 1px 3px rgba(43,49,58,.12); } .photo-view[hidden] { display:none; } .table-wrap { overflow-x:auto; } table { width:100%; min-width:620px; border-collapse:collapse; } th,td { border-bottom:1px solid var(--line); padding:13px 10px 13px 0; text-align:left; vertical-align:middle; } th { color:var(--muted); font-size:.76rem; text-transform:uppercase; letter-spacing:.06em; } .empty { color:var(--muted); } .photo-name { display:flex; gap:10px; align-items:center; min-width:0; } .photo-name span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .photo-name img { width:52px; height:40px; flex:0 0 auto; object-fit:cover; border-radius:5px; background:#e3e5e7; } .photo-processing span { color:var(--muted); } .photo-failed span { color:var(--error); } .photo-actions { display:flex; align-items:center; gap:4px; } .photo-actions form { margin:0; } .photo-actions button { display:grid; place-items:center; width:34px; height:34px; padding:0; border:0; border-radius:5px; color:#7c858d; background:transparent; cursor:pointer; } .photo-actions button:hover,.photo-actions button:focus-visible { color:var(--accent); background:#edf7f8; } .photo-actions .delete-form button:hover,.photo-actions .delete-form button:focus-visible { color:var(--error); background:var(--error-bg); } .photo-actions svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; } .photo-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; } .photo-tile { min-width:0; padding:8px; border:1px solid var(--line); border-radius:8px; background:#fafafa; } .photo-tile img,.photo-placeholder { display:block; width:100%; aspect-ratio:1.2; object-fit:cover; border-radius:5px; background:#e5e7e9; } .photo-placeholder { display:grid; place-items:center; padding:8px; color:var(--muted); font-size:.84rem; text-align:center; } .photo-tile p { margin:8px 2px 1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.86rem; } @media (max-width:720px) { main { grid-template-columns:1fr; } aside { padding:17px; } .brand { margin:0 0 15px; } nav { grid-template-columns:repeat(6,1fr); overflow:auto; } nav a { text-align:center; font-size:.83rem; } nav a small { display:none; } .rail-footer { display:none; } .content { padding:26px 17px 44px; } .upload-form { grid-template-columns:1fr; align-items:start; } .upload-queue li { align-items:flex-start; flex-direction:column; gap:6px; } .photo-grid { grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); } }
    </style>
  </head>
  <body><main>
    <aside><div class="brand">${renderLogo(156)}</div><nav><a href="/">Dashboard</a><a href="/?view=general">General</a><a href="/?view=display">Display</a><a href="/?view=schedule">Schedule</a><a class="album-nested" href="/?view=folders">Albums<small>${escapeHtml(folder.name)}</small></a><a href="/?view=status">System Status</a></nav><div class="rail-footer"><a href="/display">Open frame</a></div></aside>
    <section class="content"><header class="top"><div><p class="eyebrow">Albums</p><h1>${escapeHtml(folder.name)}</h1></div><a class="back-link" href="/?view=folders">Back to albums</a></header>
      ${renderFlash(flash)}
      <style>.upload-form{grid-template-columns:minmax(220px,auto) auto auto minmax(0,1fr)}</style>
      <style>.upload-choice{display:inline-flex;overflow:hidden;border:1px solid #cdd0d4;border-radius:999px;background:#fff}.upload-choice button{margin:0;padding:5px 11px;border:0;border-radius:0;color:var(--ink);background:#fff;font:inherit;cursor:pointer}.upload-choice button+button{border-left:1px solid #cdd0d4}.upload-choice button:hover{background:#f3f5f6}.upload-choice button.selected{color:#fff;background:var(--accent)}.upload-choice button.selected:hover{background:var(--accent)}</style>
      <style>.upload-choice button:last-child{color:var(--ink);background:#fff}.upload-choice button.selected:last-child{color:#fff;background:var(--accent)}</style>
      <style>.batch-upload-button:disabled,.clear-queue-button:disabled{color:#aeb3ba;background:#f4f5f6;cursor:not-allowed}.clear-queue-button{color:var(--ink)!important;background:#eef0f2!important}.upload-state.conflict,.upload-state.duplicate{color:var(--error);font-weight:700}</style><section class="panel"><h2>Upload photos</h2><form id="batch-upload-form" class="upload-form" method="post" action="/admin/photos/upload" enctype="multipart/form-data"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input id="batch-photo-input" type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif,image/heif" aria-label="Choose photos" multiple onchange="window.preflightDuplicateFiles(this.files)"><button id="batch-upload-button" class="batch-upload-button" type="submit" disabled>Upload</button><button id="clear-upload-queue" class="clear-queue-button" type="button" disabled>Clear</button><p id="batch-upload-help" class="upload-help">No photos in queue.</p></form><ul id="upload-queue" class="upload-queue" hidden></ul></section><script>window.preflightDuplicateFiles=async(files)=>{const selected=Array.from(files);const existingNames=new Set(queueItems.map((item)=>item.file.name));const duplicateNames=new Set();selected.forEach((file)=>{if(existingNames.has(file.name))duplicateNames.add(file.name);existingNames.add(file.name);});try{const body=new URLSearchParams({folderId,filenames:JSON.stringify(selected.map((file)=>file.name))});const response=await fetch("/admin/photos/check-duplicates",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});const result=await response.json();if(response.ok)result.duplicates.forEach((name)=>duplicateNames.add(name));}catch{}queueItems.forEach((item)=>{if(selected.includes(item.file)&&duplicateNames.has(item.file.name))item.duplicate=true;});renderQueue();document.querySelectorAll(".upload-state.queued").forEach((state,index)=>{const item=queueItems.filter((entry)=>entry.status==="queued")[index];if(item&&item.duplicate){state.classList.add("duplicate");state.textContent="Duplicate detected";}});};</script>
      <section class="panel photos-panel"><div class="photos-head"><h2>Photos (${photos.length.toString()})</h2><div class="view-switch" aria-label="Photo view"><button type="button" class="active" data-photo-view-button="detail">Detail</button><button type="button" data-photo-view-button="grid">Grid</button></div></div><section class="photo-view" data-photo-view="detail"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Dimensions</th><th>Size</th><th>Actions</th></tr></thead><tbody>${photoRows}</tbody></table></div></section><section class="photo-view" data-photo-view="grid" hidden>${photoGrid}</section></section>
    </section>
    <script>const viewButtons=document.querySelectorAll("[data-photo-view-button]"); const photoViews=document.querySelectorAll("[data-photo-view]"); viewButtons.forEach((button)=>button.addEventListener("click",()=>{const view=button.dataset.photoViewButton;viewButtons.forEach((item)=>item.classList.toggle("active",item===button));photoViews.forEach((item)=>item.hidden=item.dataset.photoView!==view);}));if(document.querySelector(".photo-processing"))window.setTimeout(()=>location.reload(),1500);const batchForm=document.querySelector("#batch-upload-form");const batchInput=document.querySelector("#batch-photo-input");const batchButton=document.querySelector("#batch-upload-button");const clearQueueButton=document.querySelector("#clear-upload-queue");const uploadHelp=document.querySelector("#batch-upload-help");const uploadQueue=document.querySelector("#upload-queue");const folderId=batchForm.querySelector("input[name=folderId]").value;const queueItems=[];let uploading=false;function renderQueue(){uploadQueue.hidden=queueItems.length===0;batchButton.disabled=!queueItems.some((item)=>item.status==="queued");clearQueueButton.disabled=queueItems.length===0||uploading;uploadHelp.textContent=queueItems.length===0?"No photos in queue.":queueItems.length.toString()+" photo"+(queueItems.length===1?"":"s")+" in queue.";uploadQueue.replaceChildren();queueItems.forEach((item)=>{const row=document.createElement("li");const file=document.createElement("span");file.className="upload-file";file.textContent=item.file.name;const state=document.createElement("span");state.className="upload-state "+item.status;if(item.status==="conflict"){state.append("Duplicate: "+item.conflict.existingFilename+" ");const choices=document.createElement("span");choices.className="upload-choice";["keep-both","replace","skip"].forEach((action)=>{const button=document.createElement("button");button.type="button";button.textContent=action==="keep-both"?"Keep both":action[0].toUpperCase()+action.slice(1);button.addEventListener("click",()=>resolveConflict(item,action));choices.append(button);});state.append(choices);}else{state.textContent=item.status==="error"?(item.message||"Upload failed"):item.status;}row.append(file,state);uploadQueue.append(row);});}async function uploadNext(){if(uploading)return;const item=queueItems.find((entry)=>entry.status==="queued");if(!item){if(queueItems.length&&queueItems.every((entry)=>entry.status==="uploaded"||entry.status==="skipped"))window.setTimeout(()=>location.reload(),700);return;}uploading=true;item.status="uploading";renderQueue();const body=new FormData();body.append("folderId",folderId);body.append("photo",item.file);try{const response=await fetch("/admin/photos/upload",{method:"POST",headers:{Accept:"application/json"},body});const result=await response.json();if(response.status===409){item.status="conflict";item.conflict=result;}else if(response.ok){item.status="uploaded";}else{item.status="error";item.message=result.message;}}catch{item.status="error";item.message="Network error";}finally{uploading=false;renderQueue();uploadNext();}}async function resolveConflict(item,action){item.status="resolving";renderQueue();const body=new URLSearchParams({folderId:item.conflict.folderId,tempBasename:item.conflict.tempBasename,originalFilename:item.conflict.originalFilename,action});try{const response=await fetch("/admin/photos/confirm-upload",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});const result=await response.json();item.status=response.ok?(action==="skip"?"skipped":"uploaded"):"error";item.message=result.message;}catch{item.status="error";item.message="Network error";}renderQueue();uploadNext();}batchInput.addEventListener("change",()=>{const added=Array.from(batchInput.files);queueItems.push(...added.map((file)=>({file,status:"queued"})));batchInput.value="";renderQueue();});clearQueueButton.addEventListener("click",()=>{queueItems.length=0;batchInput.value="";renderQueue();});batchForm.addEventListener("submit",(event)=>{event.preventDefault();uploadNext();});</script><script>batchInput.addEventListener("change",async(event)=>{const selected=Array.from(event.target.files);const existingNames=new Set(queueItems.map((item)=>item.file.name));const duplicateNames=new Set();selected.forEach((file)=>{if(existingNames.has(file.name))duplicateNames.add(file.name);existingNames.add(file.name);});try{const body=new URLSearchParams({folderId,filenames:JSON.stringify(selected.map((file)=>file.name))});const response=await fetch("/admin/photos/check-duplicates",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});const result=await response.json();if(response.ok)result.duplicates.forEach((name)=>duplicateNames.add(name));}catch{}queueItems.forEach((item)=>{if(selected.includes(item.file)&&duplicateNames.has(item.file.name)){item.duplicate=true;}});renderQueue();document.querySelectorAll(".upload-state.queued").forEach((state,index)=>{const item=queueItems.filter((entry)=>entry.status==="queued")[index];if(item&&item.duplicate){state.classList.add("duplicate");state.textContent="Duplicate detected";}});});</script>
    <script>const prepareDuplicateRows=()=>{const queued=queueItems.filter((item)=>item.status==="queued");document.querySelectorAll(".upload-state.queued").forEach((state,index)=>{const item=queued[index];if(!item||!item.duplicate)return;const stateKey=item.duplicateAction||"unresolved";if(state.dataset.duplicateState===stateKey)return;state.dataset.duplicateState=stateKey;state.classList.add("duplicate");state.replaceChildren("Duplicate found: ");const choices=document.createElement("span");choices.className="upload-choice";choices.setAttribute("role","radiogroup");choices.setAttribute("aria-label","Duplicate photo action");["keep-both","replace","skip"].forEach((action)=>{const button=document.createElement("button");button.type="button";button.textContent=action==="keep-both"?"Keep both":action[0].toUpperCase()+action.slice(1);const selected=item.duplicateAction===action;button.classList.toggle("selected",selected);button.setAttribute("role","radio");button.setAttribute("aria-checked",String(selected));button.addEventListener("click",()=>{item.duplicateAction=action;renderQueue();});choices.append(button);});state.append(choices);});const unresolved=queueItems.some((item)=>item.status==="queued"&&item.duplicate&&!item.duplicateAction);batchButton.disabled=!queued.length||unresolved;};batchForm.addEventListener("submit",()=>{queueItems.forEach((item)=>{if(item.status==="queued"&&item.duplicateAction==="skip")item.status="skipped";});renderQueue();},true);new MutationObserver(prepareDuplicateRows).observe(uploadQueue,{childList:true,subtree:true});const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(input==="/admin/photos/upload"&&init&&init.body instanceof FormData){const file=init.body.get("photo");const item=queueItems.find((entry)=>entry.file===file);if(item&&item.duplicateAction)init.body.set("duplicateAction",item.duplicateAction);}return nativeFetch(input,init);};</script>
  </main></body>
</html>`;
}

function renderDisplaySettingsPage(context: AppContext, flash: FlashMessage): string {
  const settings = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
  const folders = context.folders.list();
  const useAllFolders = settings.selectedFolderIds.length === 0;
  const folderOptions = folders.length === 0
    ? `<p class="muted">Create an album before choosing specific display albums.</p>`
    : folders.map((folder) => {
      const checked = settings.selectedFolderIds.includes(folder.id) ? " checked" : "";
      return `<label class="folder-option"><input type="checkbox" name="folder-${escapeHtml(folder.id)}"${checked}> <span>${escapeHtml(folder.name)} <small>${folder.photoCount.toString()} photos</small></span></label>`;
    }).join("\n");
  const fitSelected = settings.imagePresentationMode !== "fill" ? " selected" : "";
  const fillSelected = settings.imagePresentationMode === "fill" ? " selected" : "";
  const orderOptions: Array<[DisplaySettings["orderMode"], string]> = [
    ["random", "Random"],
    ["filename-asc", "Filename A-Z"],
    ["filename-desc", "Filename Z-A"],
    ["upload-newest", "Newest upload first"],
    ["upload-oldest", "Oldest upload first"]
  ];
  const orderSelectOptions = orderOptions.map(([value, label]) => {
    return `<option value="${value}"${settings.orderMode === value ? " selected" : ""}>${label}</option>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Display Settings - PiFrame</title>
    <style>
      :root { --bg:#f3f4f5; --panel:#fff; --ink:#4d535c; --muted:#9097a1; --line:#dedfe2; --accent:#0d8ca6; --success:#157b6d; --success-bg:#e4f4f2; --error:#af4844; --error-bg:#f9e7e6; } * { box-sizing:border-box; }
      body { margin:0; color:var(--ink); font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0%,var(--bg) 100%); } main { max-width:900px; margin:0 auto; padding:30px 18px 56px; }
      header { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:end; gap:16px; margin-bottom:22px; } h1,h2,p { margin-top:0; } p,.muted { color:var(--muted); line-height:1.55; } .panel { padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 20px rgba(43,49,58,.05); }
      form { display:grid; gap:24px; } .field { display:grid; gap:8px; font-weight:700; } input[type=number],select { width:min(100%, 320px); padding:10px 12px; border:1px solid #cdd0d4; border-radius:6px; background:#fff; font:inherit; } .folders { display:grid; gap:8px; padding:14px; border:1px solid var(--line); border-radius:8px; } .folder-option { display:flex; gap:8px; align-items:baseline; font-weight:400; } small { color:var(--muted); } button { justify-self:start; border:0; border-radius:5px; padding:10px 16px; color:#fff; background:var(--accent); font:inherit; cursor:pointer; } .flash { margin-bottom:18px; padding:14px 16px; border-radius:8px; } .flash.success { color:var(--success); background:var(--success-bg); } .flash.error { color:var(--error); background:var(--error-bg); }
    </style>
  </head>
  <body><main>
    <header>${renderLogo(142)}<div><p>PiFrame Administration</p><h1>Display settings</h1></div><p><a href="/display">Open display</a> · <a href="/admin/settings?section=folders">Back to albums</a></p></header>
    ${renderFlash(flash)}
    <section class="panel"><form method="post" action="/admin/display/save">
      <section><h2>Photo source</h2><p>Only photos whose processing status is ready can appear on the display.</p>
        <label class="field"><span><input id="use-all-folders" type="checkbox" name="useAllFolders"${useAllFolders ? " checked" : ""}> Use all albums</span></label>
        <div id="folder-options" class="folders">${folderOptions}</div>
      </section>
      <section><h2>Timing</h2><label class="field">Seconds per photo<input type="number" name="photoDurationSeconds" min="3" max="3600" step="1" value="${settings.photoDurationSeconds.toString()}" required></label></section>
      <section><h2>Playback</h2><label class="field">Ordering<select name="orderMode">${orderSelectOptions}</select></label><label class="field">Layout<select name="screenLayout"><option value="single"${settings.screenLayout === "single" ? " selected" : ""}>One photo</option><option value="triple"${settings.screenLayout === "triple" ? " selected" : ""}>Three photos</option></select></label></section>
      <section><h2>Presentation</h2><label class="field">Image sizing<select name="imagePresentationMode"><option value="fit"${fitSelected}>Fit entire photo</option><option value="fill"${fillSelected}>Fill screen, crop edges</option></select></label></section>
      <section><h2>Clock overlay</h2><label class="field"><span><input type="checkbox" name="clockEnabled"${settings.clockEnabled ? " checked" : ""}> Show local time</span></label><label class="field">Clock format<select name="clockFormat"><option value="locale-default"${settings.clockFormat === "locale-default" ? " selected" : ""}>Device default</option><option value="12h"${settings.clockFormat === "12h" ? " selected" : ""}>12-hour</option><option value="24h"${settings.clockFormat === "24h" ? " selected" : ""}>24-hour</option></select></label><label class="field">Clock size<select name="clockSize"><option value="small"${settings.clockSize === "small" ? " selected" : ""}>Small</option><option value="medium"${settings.clockSize === "medium" ? " selected" : ""}>Medium</option><option value="large"${settings.clockSize === "large" ? " selected" : ""}>Large</option></select></label><label class="field"><span><input type="checkbox" name="clockShowDate"${settings.clockShowDate ? " checked" : ""}> Show date</span></label><label class="field"><span><input type="checkbox" name="clockShowSeconds"${settings.clockShowSeconds ? " checked" : ""}> Show seconds</span></label></section>
      <button type="submit">Save display settings</button>
    </form></section>
    <script>
      const allFolders = document.querySelector("#use-all-folders");
      const folderOptions = document.querySelector("#folder-options");
      function syncFolders() { folderOptions.style.opacity = allFolders.checked ? ".5" : "1"; folderOptions.querySelectorAll("input").forEach((input) => { input.disabled = allFolders.checked; }); }
      allFolders.addEventListener("change", syncFolders); syncFolders();
    </script>
  </main></body>
</html>`;
}

function renderScheduleSettingsPage(context: AppContext, flash: FlashMessage): string {
  const settings = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Schedule - PiFrame</title>
    <style>
      :root { --bg:#f3f4f5; --panel:#fff; --ink:#4d535c; --muted:#9097a1; --line:#dedfe2; --accent:#0d8ca6; --success:#157b6d; --success-bg:#e4f4f2; --error:#af4844; --error-bg:#f9e7e6; } * { box-sizing:border-box; } body { margin:0; color:var(--ink); font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0%,var(--bg) 100%); } main { max-width:760px; margin:0 auto; padding:30px 18px 56px; } header { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:end; gap:16px; margin-bottom:22px; } h1,h2,p { margin-top:0; } p { color:var(--muted); line-height:1.55; } .panel { padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 20px rgba(43,49,58,.05); } form { display:grid; gap:22px; } .field { display:grid; gap:8px; font-weight:700; } .times { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; } input[type=time],select { width:100%; padding:10px 12px; border:1px solid #cdd0d4; border-radius:6px; background:#fff; font:inherit; } button { justify-self:start; border:0; border-radius:5px; padding:10px 16px; color:#fff; background:var(--accent); font:inherit; cursor:pointer; } .flash { margin-bottom:18px; padding:14px 16px; border-radius:8px; } .flash.success { color:var(--success); background:var(--success-bg); } .flash.error { color:var(--error); background:var(--error-bg); } @media (max-width:560px) { .times { grid-template-columns:1fr; } }
    </style>
  </head>
  <body><main>
    <header>${renderLogo(142)}<div><p>PiFrame Administration</p><h1>Daily schedule</h1></div><p><a href="/display">Open display</a> · <a href="/admin/settings?section=folders">Back to albums</a></p></header>
    ${renderFlash(flash)}
    <section class="panel"><form method="post" action="/admin/schedule/save">
      <section><h2>Display off behavior</h2><p>When off, the browser display becomes a black screen. True HDMI standby can be added later for Raspberry Pi deployments.</p><label class="field"><span><input type="checkbox" name="enabled"${settings.enabled ? " checked" : ""}> Follow a daily on/off schedule</span></label></section>
      <section class="times"><label class="field">Turn on<input type="time" name="dailyOnTime" value="${escapeHtml(settings.dailyOnTime)}" required></label><label class="field">Turn off<input type="time" name="dailyOffTime" value="${escapeHtml(settings.dailyOffTime)}" required></label></section>
      <section><label class="field">Override<select name="overrideState"><option value="follow-schedule"${settings.overrideState === "follow-schedule" ? " selected" : ""}>Follow schedule</option><option value="force-on"${settings.overrideState === "force-on" ? " selected" : ""}>Force display on</option><option value="force-off"${settings.overrideState === "force-off" ? " selected" : ""}>Force display off (black screen)</option></select></label></section>
      <button type="submit">Save schedule</button>
    </form></section>
  </main></body>
</html>`;
}

function renderUploadConflictPage(folderId: string, folderName: string, staged: StagedUpload, existingFilename: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Resolve filename conflict - PiFrame</title>
    <style>
      :root { --bg:#f3f4f5; --panel:#fff; --ink:#4d535c; --muted:#9097a1; --line:#dedfe2; --accent:#0d8ca6; --danger:#af4844; } * { box-sizing:border-box; } body { margin:0; color:var(--ink); font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0%,var(--bg) 100%); } main { max-width:700px; margin:0 auto; padding:48px 18px; } .panel { padding:26px; border:1px solid var(--line); border-radius:12px; background:var(--panel); box-shadow:0 8px 20px rgba(43,49,58,.05); } p { color:var(--muted); line-height:1.55; } form { display:grid; gap:14px; margin-top:24px; } label { display:block; padding:14px; border:1px solid var(--line); border-radius:8px; } label span { display:block; color:var(--muted); margin:5px 0 0 25px; } button { border:0; border-radius:5px; padding:10px 16px; font:inherit; color:#fff; background:var(--accent); cursor:pointer; } button.secondary { color:var(--ink); background:#eef0f2; } .actions { display:flex; gap:10px; flex-wrap:wrap; } code { font-family:Menlo,monospace; }
    </style>
  </head>
  <body><main>${renderLogo(142)}<section class="panel"><p>PiFrame Administration / ${escapeHtml(folderName)}</p><h1>Filename conflict</h1>
    <p><strong>${escapeHtml(staged.originalFilename)}</strong> already exists in this album. Choose an explicit action for the staged image (${escapeHtml(formatBytes(staged.fileSizeBytes))}).</p>
    <form method="post" action="/admin/photos/confirm-upload"><input type="hidden" name="folderId" value="${escapeHtml(folderId)}"><input type="hidden" name="tempBasename" value="${escapeHtml(staged.tempBasename)}"><input type="hidden" name="originalFilename" value="${escapeHtml(staged.originalFilename)}">
      <label><input type="radio" name="action" value="keep-both" checked> Keep both<span>Store this as another photo while preserving the displayed filename.</span></label>
      <label><input type="radio" name="action" value="replace"> Replace existing<span>Replace the existing <code>${escapeHtml(existingFilename)}</code> original. Its saved rotation remains attached to the photo record.</span></label>
      <label><input type="radio" name="action" value="skip"> Skip incoming image<span>Discard the staged upload and keep the current library unchanged.</span></label>
      <div class="actions"><button type="submit">Save choice</button><a href="${folderPhotosPath(folderId)}"><button type="button" class="secondary">Cancel</button></a></div>
    </form>
  </section></main></body>
</html>`;
}

function renderStatusPage(context: AppContext): string {
  const folders = context.folders.list();
  const displaySettings = context.settings.getJson("display") ?? createDefaultDisplaySettings();
  const scheduleSettings = context.settings.getJson("schedule") ?? createDefaultScheduleSettings();
  const events = context.events.listRecent(8);

  const eventItems = events.length === 0
    ? `<li>No events recorded yet.</li>`
    : events
        .map((event) => {
          return `<li>
  <strong>${escapeHtml(event.level.toUpperCase())}</strong>
  <span>${escapeHtml(event.message)}</span>
  <code>${escapeHtml(event.code)}</code>
  <time datetime="${escapeHtml(event.createdAt)}">${escapeHtml(formatTimestamp(event.createdAt))}</time>
</li>`;
        })
        .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Status</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f4f5;
        --panel: #ffffff;
        --ink: #4d535c;
        --muted: #9097a1;
        --line: #dedfe2;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        color: var(--ink);
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #fafafa 0%, var(--bg) 100%);
      }

      main {
        max-width: 1000px;
        margin: 0 auto;
        padding: 28px 18px 48px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: end;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 22px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 20px;
      }

      h1, h2, h3, p {
        margin-top: 0;
      }

      p, li {
        color: var(--muted);
        line-height: 1.6;
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 8px 14px;
        margin: 0;
      }

      dt { font-weight: 700; }
      dd { margin: 0; }

      ul {
        margin: 0;
        padding-left: 20px;
      }

      code {
        font-family: "SFMono-Regular", Menlo, monospace;
        font-size: 0.95em;
      }

      @media (max-width: 840px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        ${renderLogo(142)}
        <div>
          <p>PiFrame Administration</p>
          <h1>Status</h1>
        </div>
        <p><a href="/admin/settings?section=folders">Back to albums</a></p>
      </header>
      <section class="grid">
        <section class="panel">
          <h2>System</h2>
          <dl>
            <dt>Platform</dt>
            <dd><code>${escapeHtml(context.config.platform)}</code></dd>
            <dt>Host</dt>
            <dd><code>${escapeHtml(context.config.host)}</code></dd>
            <dt>Port</dt>
            <dd><code>${context.config.port.toString()}</code></dd>
            <dt>Album count</dt>
            <dd>${folders.length.toString()}</dd>
            <dt>Data root</dt>
            <dd><code>${escapeHtml(context.config.paths.dataRoot)}</code></dd>
            <dt>Database</dt>
            <dd><code>${escapeHtml(context.config.paths.databaseFile)}</code></dd>
          </dl>
        </section>
        <section class="panel">
          <h2>Managed paths</h2>
          <dl>
            <dt>Originals</dt>
            <dd><code>${escapeHtml(context.config.paths.originalsDir)}</code></dd>
            <dt>Thumbnails</dt>
            <dd><code>${escapeHtml(context.config.paths.thumbnailsDir)}</code></dd>
            <dt>Display</dt>
            <dd><code>${escapeHtml(context.config.paths.displayDir)}</code></dd>
            <dt>Blurred</dt>
            <dd><code>${escapeHtml(context.config.paths.blurredDir)}</code></dd>
            <dt>Logs</dt>
            <dd><code>${escapeHtml(context.config.paths.logsDir)}</code></dd>
            <dt>Temp</dt>
            <dd><code>${escapeHtml(context.config.paths.tempDir)}</code></dd>
          </dl>
        </section>
        <section class="panel">
          <h2>Display defaults</h2>
          <pre>${escapeHtml(JSON.stringify(displaySettings, null, 2))}</pre>
        </section>
        <section class="panel">
          <h2>Schedule defaults</h2>
          <pre>${escapeHtml(JSON.stringify(scheduleSettings, null, 2))}</pre>
        </section>
        <section class="panel">
          <h2>Recent events</h2>
          <ul>
            ${eventItems}
          </ul>
        </section>
      </section>
    </main>
  </body>
</html>`;
}

function renderHealthPage(context: AppContext): string {
  const stats = context.photos.stats();
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Health - PiFrame</title>
    <style>
      body { margin:0; color:#4d535c; font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0,#f3f4f5 100%); } main { max-width:760px; min-height:100vh; margin:auto; padding:34px 20px; } .card { margin-top:38px; padding:26px; background:#fff; border:1px solid #dedfe2; border-radius:12px; box-shadow:0 8px 20px rgba(43,49,58,.05); } h1 { margin:0 0 10px; font-size:clamp(2rem,5vw,3.4rem); letter-spacing:-.05em; } p { color:#9097a1; line-height:1.55; } .ok { color:#157b6d; font-weight:700; } dl { display:grid; grid-template-columns:max-content 1fr; gap:10px 18px; margin:24px 0 0; } dt { color:#9097a1; } dd { margin:0; font-weight:700; } code { color:#0d8ca6; }
    </style>
  </head>
  <body><main>${renderLogo(160)}<section class="card"><p class="ok">System healthy</p><h1>PiFrame is running.</h1><p>The local server and SQLite library are available.</p><dl><dt>Platform</dt><dd><code>${escapeHtml(context.config.platform)}</code></dd><dt>Host</dt><dd><code>${escapeHtml(context.config.host)}:${context.config.port.toString()}</code></dd><dt>Ready photos</dt><dd>${stats.ready.toString()}</dd><dt>Photos needing attention</dt><dd>${(stats.pending + stats.processing + stats.failed).toString()}</dd></dl></section></main></body>
</html>`;
}

function renderNotFoundPage(pathname: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Not found</title>
    <style>
      body { margin:0; color:#4d535c; font-family:Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fafafa 0,#f3f4f5 100%); }
      main { max-width:700px; min-height:100vh; margin:0 auto; padding:36px 20px; }
      h1 { margin-top:46px; font-size:clamp(2rem,5vw,3.5rem); letter-spacing:-.05em; }
      p { color:#9097a1; line-height:1.55; } code { color:#0d8ca6; }
    </style>
  </head>
  <body>
    <main>
      ${renderLogo(142)}
      <h1>Not found</h1>
      <p>No route is defined for <code>${escapeHtml(pathname)}</code>.</p>
    </main>
  </body>
</html>`;
}

function parseDisplayDuration(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const duration = Number(raw);
  if (!Number.isInteger(duration) || duration < 3 || duration > 3600) {
    throw new Error("Photo duration must be between 3 seconds and 1 hour.");
  }
  return duration;
}

function parsePresentationMode(
  raw: string | undefined,
  fallback: DisplaySettings["imagePresentationMode"]
): DisplaySettings["imagePresentationMode"] {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (raw === "fit" || raw === "fill") {
    return raw;
  }
  throw new Error("Choose a valid image presentation mode.");
}

function parseManualRotation(raw: string | undefined): number {
  const rotation = Number(raw);
  if (rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270) {
    return rotation;
  }
  throw new Error("Choose a valid rotation.");
}

function parseOrderMode(raw: string | undefined, fallback: DisplaySettings["orderMode"]): DisplaySettings["orderMode"] {
  const validModes: DisplaySettings["orderMode"][] = [
    "random", "filename-asc", "filename-desc", "upload-newest", "upload-oldest", "capture-newest", "capture-oldest"
  ];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (validModes.includes(raw as DisplaySettings["orderMode"])) {
    return raw as DisplaySettings["orderMode"];
  }
  throw new Error("Choose a valid photo ordering mode.");
}

function parseScreenLayout(raw: string | undefined, fallback: DisplaySettings["screenLayout"]): DisplaySettings["screenLayout"] {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (raw === "single" || raw === "triple") {
    return raw;
  }
  throw new Error("Choose a valid screen layout.");
}

function parseClockFormat(raw: string | undefined, fallback: DisplaySettings["clockFormat"]): DisplaySettings["clockFormat"] {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (raw === "locale-default" || raw === "12h" || raw === "24h") {
    return raw;
  }
  throw new Error("Choose a valid clock format.");
}

function parseClockSize(raw: string | undefined, fallback: DisplaySettings["clockSize"]): DisplaySettings["clockSize"] {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (raw === "small" || raw === "medium" || raw === "large") {
    return raw;
  }
  throw new Error("Choose a valid clock size.");
}

function parseTimeOfDay(raw: string | undefined): string {
  if (!raw || !/^\d{2}:\d{2}$/.test(raw)) {
    throw new Error("Enter a valid daily time.");
  }
  const [hours, minutes] = raw.split(":").map(Number);
  if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) {
    throw new Error("Enter a valid daily time.");
  }
  return raw;
}

function parseScheduleOverride(raw: string | undefined): ScheduleSettings["overrideState"] {
  if (raw === "follow-schedule" || raw === "force-on" || raw === "force-off") {
    return raw;
  }
  throw new Error("Choose a valid schedule override.");
}

function folderPhotosPath(folderId: string): string {
  return `/admin/folders/${encodeURIComponent(folderId)}/photos`;
}

function settingsLocation(section: "display" | "schedule" | "folders", kind: "success" | "error", message: string): string {
  return `/?view=${section}&${kind}=${encodeURIComponent(message)}`;
}
