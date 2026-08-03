import { rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createDefaultDisplaySettings, createDefaultScheduleSettings, type DisplaySettings, type ScheduleSettings } from "../core/settings.js";
import { validateFolderName } from "../core/folders.js";
import type { AppContext } from "../data/app-context.js";
import type { PhotoRecord } from "../data/photo-repository.js";
import { PhotoIngestionService, type StagedUpload } from "../services/photo-ingestion.js";
import { isUniqueConstraintError } from "./http/errors.js";
import { readForm, readMultipartUpload, requireFormValue } from "./http/forms.js";
import { isTrustedOrigin, prefersJson } from "./http/request.js";
import { redirect, sendBinary, sendHtml, sendJson, sendPlainText } from "./http/responses.js";
import { isDisplayOn, selectDisplayPhotos } from "./display-state.js";
import { handleDisplayRoute } from "./routes/display.js";
import { handleSystemRoute } from "./routes/system.js";
import { handleWorkspaceGetRoute } from "./routes/workspace.js";
import { handleSettingsActions } from "./routes/settings-actions.js";
import { folderPhotosPath, settingsLocation } from "./urls.js";
import { escapeHtml, formatBytes, formatTimestamp, readFlash, renderFlash, renderLogo, type FlashMessage } from "./views/shared.js";
import { renderHealthPage as renderHealthView, renderNotFoundPage as renderNotFoundView } from "./views/system.js";
import { renderDisplayPage } from "./views/display.js";
import { renderHomePage } from "./views/dashboard.js";
import { renderDisplaySettingsPage, renderFolderPhotosPage, renderFoldersPage, renderScheduleSettingsPage, renderSettingsPage, renderStatusPage, renderUploadConflictPage } from "./views/workspace.js";

interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export function createApp(context: AppContext): App {
  const ingestion = new PhotoIngestionService(context.config, context.photos);

  return {
    async handle(req, res) {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (await handleSystemRoute(context, req, res, url, renderHealthView)) return;

      if (handleDisplayRoute(context, req, res, url, renderDisplayPage)) return;
      if (handleWorkspaceGetRoute(context, req, res, url, {
        settings: renderSettingsPage,
        album: renderFolderPhotosPage,
        albums: renderFoldersPage,
        display: renderDisplaySettingsPage,
        notFound: renderNotFoundView
      })) return;

      if (await handleSettingsActions(context, req, res, url)) return;

      if (method === "GET" && url.pathname === "/admin/schedule") {
        return sendHtml(res, 200, renderScheduleSettingsPage(context, readFlash(url)));
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

      sendHtml(res, 404, renderNotFoundView(url.pathname));
    }
  };
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
