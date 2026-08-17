import { hostname, networkInterfaces } from "node:os";
import { createDefaultDisplaySettings, createDefaultFrameSettings, createDefaultScheduleSettings, normalizeAdministrationTheme, type AdministrationTheme, type DisplaySettings, type FrameSettings, type ScheduleSettings } from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import type { PhotoRecord } from "../../data/photo-repository.js";
import type { StagedUpload } from "../../services/photo-ingestion.js";
import { isDisplayOn } from "../display-state.js";
import { folderPhotosPath } from "../urls.js";
import { escapeHtml, formatBytes, formatTimestamp, renderFlash, renderLogo, type FlashMessage } from "./shared.js";
import { renderNotFoundPage } from "./system.js";
import { renderAlbumsPanel } from "./workspace/albums.js";
import { renderDashboardPanel } from "./workspace/dashboard.js";
import { renderFramePanel } from "./workspace/frame.js";
import { renderHelpContents, renderHelpPanel } from "./workspace/help.js";
import { renderPresentationPanel } from "./workspace/presentation.js";
import { renderSchedulePanel } from "./workspace/schedule.js";
import { renderAdministrationThemeMetadata, renderWorkspaceShell } from "./workspace/shell.js";
import { renderStatusPanel } from "./workspace/status.js";

function administrationTheme(context: AppContext): AdministrationTheme {
  const frame = context.settings.getJson<FrameSettings>("frame") ?? createDefaultFrameSettings();
  return normalizeAdministrationTheme(frame.theme);
}

function systemNetworkIdentity(): { hostname: string; address: string | null } {
  const shortHostname = hostname();
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, interfaces]) =>
    (interfaces ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254."))
      .map((address) => ({ name, address: address.address }))
  );
  const preferred = addresses.find(({ name }) => /^(?:eth|en|wl)/.test(name)) ?? addresses[0];
  return {
    hostname: shortHostname.endsWith(".local") ? shortHostname : `${shortHostname}.local`,
    address: preferred?.address ?? null
  };
}

function renderDetailRows(rows: Array<[string, string]>): string {
  return `<dl style="display:grid;gap:8px;margin:0">${rows.map(([label, value]) => `<div style="display:flex;gap:8px"><dt style="min-width:110px;font-weight:700">${escapeHtml(label)}:</dt><dd style="margin:0;min-width:0;overflow-wrap:anywhere"><code>${value}</code></dd></div>`).join("")}</dl>`;
}

export function renderSettingsPage(context: AppContext, flash: FlashMessage, requestedSection: string | null): string {
  const validSections = ["dashboard", "general", "presentation", "schedule", "folders", "status", "help"] as const;
  const normalizedSection = requestedSection === "display" ? "presentation" : requestedSection;
  const activeSection = validSections.includes(normalizedSection as typeof validSections[number]) ? normalizedSection as typeof validSections[number] : "dashboard";
  const sectionLabel = (section: typeof validSections[number]): string => {
    if (section === "folders") return "Albums";
    if (section === "status") return "System Status";
    if (section === "general") return "Frame";
    if (section === "presentation") return "Presentation";
    if (section === "help") return "Help";
    return `${section[0]?.toUpperCase()}${section.slice(1)}`;
  };
  const display = context.settings.getJson<DisplaySettings>("display") ?? createDefaultDisplaySettings();
  const frame = context.settings.getJson<FrameSettings>("frame") ?? createDefaultFrameSettings();
  const theme = normalizeAdministrationTheme(frame.theme);
  const schedule = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  const folders = context.folders.list();
  const stats = context.photos.stats();
  const events = context.events.listRecent(8);
  const networkIdentity = systemNetworkIdentity();
  const displayOn = isDisplayOn(schedule, new Date(), frame.timeZone);
  const allFolders = display.selectedFolderIds.length === 0;
  const folderChecks = folders.length === 0
    ? `<p class="muted">Create an album before choosing specific display albums.</p>`
    : folders.map((folder) => `<label class="check"><input type="checkbox" name="folder-${escapeHtml(folder.id)}"${display.selectedFolderIds.includes(folder.id) ? " checked" : ""}> ${escapeHtml(folder.name)} <small>${folder.photoCount.toString()} photos</small></label>`).join("");
  const eventRows = events.length === 0
    ? `<p class="muted">No recent activity.</p>`
    : `<ul class="event-list">${events.map((event) => `<li><strong>${escapeHtml(event.level.toUpperCase())}</strong><span>${escapeHtml(event.message)}</span><time>${escapeHtml(formatTimestamp(event.createdAt))}</time></li>`).join("")}</ul>`;
  const systemActionControls = context.config.platform === "raspberry-pi"
    ? `<section class="card system-actions" style="margin-top:16px"><h3>Power</h3><p class="muted">These actions affect the entire Pi, including the display and local network connection.</p><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px"><form method="post" action="/admin/system/action" style="display:block"><input type="hidden" name="action" value="restart"><button class="system-restart" type="submit" style="border:0;padding:10px 17px;border-radius:5px;color:#fff;font:inherit;cursor:pointer" onclick="return confirm('Restart this Pi now? The display and local connection will be unavailable briefly.');">Restart Pi</button></form><form method="post" action="/admin/system/action" style="display:block"><input type="hidden" name="action" value="shutdown"><button class="system-shutdown" type="submit" style="border:0;padding:10px 17px;border-radius:5px;color:#fff;font:inherit;cursor:pointer" onclick="return confirm('Shut down this Pi now? Wait for the display to go dark before removing power.');">Shut down Pi</button></form></div></section>`
    : "";
  const systemDetails = renderDetailRows([
    ["Frame ID", escapeHtml(frame.frameId)],
    ["Platform", escapeHtml(context.config.platform)],
    ["Host", `${escapeHtml(networkIdentity.hostname)}${networkIdentity.address ? ` (${escapeHtml(networkIdentity.address)})` : ""}`],
    ["Data root", escapeHtml(context.config.paths.dataRoot)],
    ["Database", escapeHtml(context.config.paths.databaseFile)]
  ]);
  const storageDetails = renderDetailRows([
    ["Originals", escapeHtml(context.config.paths.originalsDir)],
    ["Thumbnails", escapeHtml(context.config.paths.thumbnailsDir)],
    ["Display assets", escapeHtml(context.config.paths.displayDir)]
  ]);
  const helpContents = renderHelpContents(activeSection === "help");

  const panels = [
    renderDashboardPanel(activeSection === "dashboard", display, stats, displayOn),
    renderFramePanel(activeSection === "general", frame),
    renderPresentationPanel(activeSection === "presentation", display, allFolders, folderChecks),
    renderSchedulePanel(activeSection === "schedule", schedule),
    renderAlbumsPanel(activeSection === "folders", folders),
    renderStatusPanel(activeSection === "status", systemDetails, storageDetails, systemActionControls, eventRows),
    renderHelpPanel(activeSection === "help")
  ].join("\n");

  return renderWorkspaceShell({
    activeSection,
    display,
    flash,
    helpContents,
    panels,
    sectionLabel,
    theme
  });
}

export function renderFoldersPage(context: AppContext, flash: FlashMessage): string {
  const theme = administrationTheme(context);
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
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Admin</title>${renderAdministrationThemeMetadata(theme)}
    <link rel="stylesheet" href="/assets/app/albums.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
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

export function renderFolderPhotosPage(context: AppContext, folderId: string, flash: FlashMessage): string {
  const theme = administrationTheme(context);
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
      return `<tr data-photo-id="${escapeHtml(photo.id)}">
  <td><div class="photo-name${nameState}">${photo.processingStatus === "ready" ? `<button class="photo-preview-trigger" type="button" data-photo-preview-src="/media/display/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" data-photo-preview-alt="${escapeHtml(photo.originalFilename)}" aria-label="View ${escapeHtml(photo.originalFilename)} larger"><img src="/media/thumbnail/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" alt=""></button>` : ""}<span title="${escapeHtml(nameTitle)}">${escapeHtml(displayName)}</span></div></td>
  <td>${photo.widthPx && photo.heightPx ? `${photo.widthPx.toString()} x ${photo.heightPx.toString()}` : "Unknown"}</td>
  <td>${formatBytes(photo.fileSizeBytes)}</td>
  <td><div class="photo-actions">${photo.processingStatus === "failed" ? `<form method="post" action="/admin/photos/retry"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><button type="submit" aria-label="Retry ${escapeHtml(photo.originalFilename)}" title="Retry processing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5m-2-5V5m0 6h-6"/></svg></button></form>` : ""}<form method="post" action="/admin/photos/rotation"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><input type="hidden" name="rotation" value="${rotateLeft.toString()}"><button type="submit" aria-label="Rotate ${escapeHtml(photo.originalFilename)} left" title="Rotate left"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg></button></form><form method="post" action="/admin/photos/rotation"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><input type="hidden" name="rotation" value="${rotateRight.toString()}"><button type="submit" aria-label="Rotate ${escapeHtml(photo.originalFilename)} right" title="Rotate right"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg></button></form><form method="post" action="/admin/photos/delete" class="delete-form"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><button type="submit" aria-label="Delete ${escapeHtml(photo.originalFilename)}" title="Delete photo" onclick="return confirm('Delete this photo and its managed files?');"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13"/></svg></button></form></div></td>
</tr>`;
    }).join("\n");
  const photoGrid = photos.length === 0
    ? `<p class="empty">No photos in this album yet.</p>`
    : `<div class="photo-grid" data-folder-id="${escapeHtml(folder.id)}">${photos.map((photo) => `<article class="photo-tile" data-photo-id="${escapeHtml(photo.id)}" data-photo-name="${escapeHtml(photo.originalFilename)}" data-photo-created-at="${escapeHtml(photo.createdAt)}">${photo.processingStatus === "ready" ? `<button class="photo-preview-trigger" type="button" data-photo-preview-src="/media/display/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" data-photo-preview-alt="${escapeHtml(photo.originalFilename)}" aria-label="View ${escapeHtml(photo.originalFilename)} larger"><img src="/media/thumbnail/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" alt=""></button>` : `<div class="photo-placeholder">${escapeHtml(photo.processingStatus)}</div>`}<p title="${escapeHtml(photo.originalFilename)}">${escapeHtml(photo.originalFilename)}</p></article>`).join("")}</div>`;

  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(folder.name)} photos - PiFrame</title>${renderAdministrationThemeMetadata(theme)}
    <link rel="stylesheet" href="/assets/app/album.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
  </head>
  <body><main>
    <aside><div class="brand">${renderLogo(156)}</div><nav><a href="/">Dashboard</a><a href="/?view=general">Frame</a><a href="/?view=presentation">Presentation</a><a href="/?view=schedule">Schedule</a><a class="album-nested" href="/?view=folders">Albums<small>${escapeHtml(folder.name)}</small></a><a href="/?view=status">System Status</a><a href="/?view=help">Help</a></nav><div class="rail-footer"><a href="/display">Open frame</a></div></aside>
    <section class="content"><header class="top"><div><p class="eyebrow">Albums</p><h1>${escapeHtml(folder.name)}</h1></div><a class="back-link" href="/?view=folders">Back to albums</a></header>
      ${renderFlash(flash)}
      
      
      
      <section class="panel"><h2>Upload photos</h2><form id="batch-upload-form" class="upload-form" method="post" action="/admin/photos/upload" enctype="multipart/form-data"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input id="batch-photo-input" type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif,image/heif" aria-label="Choose photos" multiple onchange="window.preflightDuplicateFiles(this.files)"><button id="batch-upload-button" class="batch-upload-button" type="submit" disabled>Upload</button><button id="clear-upload-queue" class="clear-queue-button" type="button" disabled>Clear</button><p id="batch-upload-help" class="upload-help">No photos in queue.</p></form><ul id="upload-queue" class="upload-queue" hidden></ul></section><script src="/assets/app/album-queue.js" defer></script>
      <section class="panel photos-panel"><div class="photos-head"><h2>Photos (${photos.length.toString()})</h2><div class="photo-controls"><label class="photo-sort">Sort <select id="photo-sort"><option value="manual">Manual</option><option value="date">Upload date (newest first)</option><option value="alphabetical">Alphabetical</option></select></label><div class="view-switch" aria-label="Photo view"><button type="button" class="active" data-photo-view-button="detail">Detail</button><button type="button" data-photo-view-button="grid">Grid</button></div></div></div><p id="photo-order-status" class="photo-order-status" aria-live="polite"></p><section class="photo-view" data-photo-view="detail"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Dimensions</th><th>Size</th><th>Actions</th></tr></thead><tbody>${photoRows}</tbody></table></div></section><section class="photo-view" data-photo-view="grid" hidden>${photoGrid}</section></section>
    </section>
    <dialog id="photo-preview-dialog" class="photo-preview-dialog" aria-label="Photo preview"><button class="photo-preview-close" type="button" data-photo-preview-close aria-label="Close photo preview">×</button><img id="photo-preview-image" alt=""></dialog>
    <script src="/assets/app/album-interactions.js" defer></script>
  </main></body>
</html>`;
}

export function renderDisplaySettingsPage(context: AppContext, flash: FlashMessage): string {
  const theme = administrationTheme(context);
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
    ["upload-oldest", "Oldest upload first"],
    ["manual", "Manual album order"]
  ];
  const orderSelectOptions = orderOptions.map(([value, label]) => {
    return `<option value="${value}"${settings.orderMode === value ? " selected" : ""}>${label}</option>`;
  }).join("");

  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Display Settings - PiFrame</title>${renderAdministrationThemeMetadata(theme)}
    <link rel="stylesheet" href="/assets/app/display-settings.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
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
      <section><h2>Presentation</h2><label class="field">Image sizing<select name="imagePresentationMode"><option value="fit"${fitSelected}>Fit entire photo</option><option value="fill"${fillSelected}>Fill and Crop</option></select></label></section>
      <section><h2>Clock overlay</h2><label class="field"><span><input type="checkbox" name="clockEnabled"${settings.clockEnabled ? " checked" : ""}> Show local time</span></label><label class="field">Clock format<select name="clockFormat"><option value="locale-default"${settings.clockFormat === "locale-default" ? " selected" : ""}>Device default</option><option value="12h"${settings.clockFormat === "12h" ? " selected" : ""}>12-hour</option><option value="24h"${settings.clockFormat === "24h" ? " selected" : ""}>24-hour</option></select></label><label class="field">Clock size<select name="clockSize"><option value="small"${settings.clockSize === "small" ? " selected" : ""}>Small</option><option value="medium"${settings.clockSize === "medium" ? " selected" : ""}>Medium</option><option value="large"${settings.clockSize === "large" ? " selected" : ""}>Large</option></select></label><label class="field"><span><input type="checkbox" name="clockShowDate"${settings.clockShowDate ? " checked" : ""}> Show date</span></label></section>
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

export function renderScheduleSettingsPage(context: AppContext, flash: FlashMessage): string {
  const theme = administrationTheme(context);
  const settings = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Schedule - PiFrame</title>${renderAdministrationThemeMetadata(theme)}
    <link rel="stylesheet" href="/assets/app/schedule-settings.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
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

export function renderUploadConflictPage(context: AppContext, folderId: string, folderName: string, staged: StagedUpload, existingFilename: string): string {
  const theme = administrationTheme(context);
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${renderAdministrationThemeMetadata(theme)}<title>Resolve filename conflict - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/upload-conflict.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
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

export function renderStatusPage(context: AppContext): string {
  const theme = administrationTheme(context);
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
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Status</title>${renderAdministrationThemeMetadata(theme)}
    <link rel="stylesheet" href="/assets/app/status.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
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
