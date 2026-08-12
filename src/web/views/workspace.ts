import { hostname, networkInterfaces } from "node:os";
import { createDefaultDisplaySettings, createDefaultFrameSettings, createDefaultScheduleSettings, type DisplaySettings, type FrameSettings, type ScheduleSettings } from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import type { PhotoRecord } from "../../data/photo-repository.js";
import type { StagedUpload } from "../../services/photo-ingestion.js";
import { isDisplayOn } from "../display-state.js";
import { folderPhotosPath } from "../urls.js";
import { escapeHtml, formatBytes, formatTimestamp, renderFlash, renderLogo, type FlashMessage } from "./shared.js";
import { renderNotFoundPage } from "./system.js";

function renderGeneralSettingsPanel(settings: FrameSettings): string {
  const timeZones = Intl.supportedValuesOf("timeZone").map((timeZone) => `<option value="${escapeHtml(timeZone)}"></option>`).join("");
  const orientationOptions: Array<{ value: FrameSettings["displayOrientation"]; label: string; arrow: string; shape: "landscape" | "portrait" }> = [
    { value: 0, label: "0 degrees (normal)", arrow: "↑", shape: "landscape" },
    { value: 90, label: "90 degrees (clockwise)", arrow: "→", shape: "portrait" },
    { value: 180, label: "180 degrees", arrow: "↓", shape: "landscape" },
    { value: 270, label: "270 degrees (counter-clockwise)", arrow: "←", shape: "portrait" }
  ];

  return `<div class="card"><form method="post" action="/admin/general/save">
    <section class="section"><h3>Frame identity</h3><p class="muted">The frame name is reserved for the Pi hostname when device setup is added. Saving it does not change this computer's hostname.</p><label class="field">Frame name<input type="text" name="frameName" value="${escapeHtml(settings.frameName)}" maxlength="63" pattern="[a-z0-9]+" autocapitalize="none" spellcheck="false" required><small>One lowercase word using letters and numbers.</small></label><label class="field">Frame description<input type="text" name="frameDescription" value="${escapeHtml(settings.frameDescription)}" maxlength="80" placeholder="Living Room"><small>A one-line description, up to 80 characters.</small></label><p class="frame-id">Frame ID <code>${escapeHtml(settings.frameId)}</code></p></section>
    <section class="section"><h3>Location and time</h3><div class="location-field"><div class="location-label">Location <span class="location-info-wrap"><button class="location-info" type="button" aria-label="About location search" aria-describedby="location-search-info">i</button><span id="location-search-info" class="location-tooltip" role="tooltip">Search to choose a matching place. Location lookups via Open-Meteo are requested only when you choose to search.</span></span></div><div class="location-input-row"><input id="frame-location" type="text" name="location" value="${escapeHtml(settings.location)}" maxlength="80" placeholder="City, state, country or postal code"><button id="search-location" class="secondary-action" type="button">Search location</button></div><input id="weather-latitude" type="hidden" name="weatherLatitude" value="${settings.weatherLocation?.latitude ?? ""}"><input id="weather-longitude" type="hidden" name="weatherLongitude" value="${settings.weatherLocation?.longitude ?? ""}"></div><p id="location-lookup-status" class="muted location-status" aria-live="polite"></p><div id="location-search-results" class="location-results" hidden></div><details class="advanced-location"><summary>Advanced location settings</summary><div class="advanced-location-fields"><label class="field">Time zone<input id="frame-time-zone" type="text" name="timeZone" value="${escapeHtml(settings.timeZone)}" list="time-zone-options" required><small>Used for scheduling and the clock.</small></label><datalist id="time-zone-options">${timeZones}</datalist><label class="field">Language<select name="language"><option value="en-US"${settings.language === "en-US" ? " selected" : ""}>English (United States)</option></select><small>More interface languages will be available when PiFrame is translated.</small></label></div></details></section>
    <section class="section"><h3>Physical display</h3><fieldset class="orientation-choices"><legend>Display orientation</legend><div class="orientation-options">${orientationOptions.map(({ value, label, arrow, shape }) => `<label class="orientation-choice" title="${label}"><input type="radio" name="displayOrientation" value="${value.toString()}"${settings.displayOrientation === value ? " checked" : ""}><span class="orientation-screen ${shape}" aria-hidden="true">${arrow}</span><span class="sr-only">${label}</span></label>`).join("")}</div></fieldset></section>
    <button class="save" type="submit">Save frame settings</button>
  </form><script src="/assets/app/general-location.js" defer></script></div>`;
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
  const folderList = `<div class="album-table-wrap"><table class="album-table"><colgroup><col class="album-name-column"><col class="album-count-column"><col><col class="album-action-column"><col class="album-delete-column"></colgroup><tbody>${folders.map((folder) => { const renameFormId = `rename-album-${folder.id}`; const renameButtonId = `${renameFormId}-submit`; return `<tr><td><a class="album-name" href="${folderPhotosPath(folder.id)}"><span>${escapeHtml(folder.name)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5"/></svg></a></td><td class="album-count">${folder.photoCount.toString()} photos</td><td><form id="${renameFormId}" class="album-rename" method="post" action="/admin/folders/rename"><input type="hidden" name="id" value="${escapeHtml(folder.id)}"><input type="text" name="name" value="${escapeHtml(folder.name)}" maxlength="120" aria-label="Rename ${escapeHtml(folder.name)}" oninput="document.getElementById('${renameButtonId}').disabled = this.value === this.defaultValue" required></form></td><td><button id="${renameButtonId}" class="album-action" type="submit" form="${renameFormId}" disabled>Rename</button></td><td><form class="album-delete" method="post" action="/admin/folders/delete"><input type="hidden" name="id" value="${escapeHtml(folder.id)}"><button type="submit" aria-label="Delete ${escapeHtml(folder.name)}" title="Delete album" onclick="return confirm('Delete this album and all of its photos?') && confirm('This cannot be undone. Are you absolutely sure you want to delete this entire album?');"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13"/></svg></button></form></td></tr>`; }).join("")}<tr class="album-create"><td><span class="album-new-name">New Album</span></td><td class="album-count">0 photos</td><td><form id="create-album" method="post" action="/admin/folders/create"><input type="text" name="name" maxlength="120" placeholder="Enter new album name" aria-label="New album name" required></form></td><td><button class="album-action" type="submit" form="create-album">Create</button></td><td></td></tr></tbody></table></div>`;
  const eventRows = events.length === 0
    ? `<p class="muted">No recent activity.</p>`
    : `<ul class="event-list">${events.map((event) => `<li><strong>${escapeHtml(event.level.toUpperCase())}</strong><span>${escapeHtml(event.message)}</span><time>${escapeHtml(formatTimestamp(event.createdAt))}</time></li>`).join("")}</ul>`;
  const systemActionControls = context.config.platform === "raspberry-pi"
    ? `<section class="card system-actions" style="margin-top:16px"><h3>Power</h3><p class="muted">These actions affect the entire Pi, including the display and local network connection.</p><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px"><form method="post" action="/admin/system/action" style="display:block"><input type="hidden" name="action" value="restart"><button type="submit" style="border:0;padding:10px 17px;border-radius:5px;color:#fff;background:#59636e;font:inherit;cursor:pointer" onclick="return confirm('Restart this Pi now? The display and local connection will be unavailable briefly.');">Restart Pi</button></form><form method="post" action="/admin/system/action" style="display:block"><input type="hidden" name="action" value="shutdown"><button type="submit" style="border:0;padding:10px 17px;border-radius:5px;color:#fff;background:#af4844;font:inherit;cursor:pointer" onclick="return confirm('Shut down this Pi now? Wait for the display to go dark before removing power.');">Shut down Pi</button></form></div></section>`
    : "";
  const systemDetails = renderDetailRows([
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
  const helpContents = `<nav id="help-toc" class="help-toc" aria-label="Help contents"${activeSection === "help" ? "" : " hidden"}><a href="#overview" data-help-section="overview">Overview</a><a href="#first-connection" data-help-section="first-connection">First connection</a><a href="#start" data-help-section="start">Quick start</a><a href="#views" data-help-section="views">Views and controls</a><a href="#care" data-help-section="care">Everyday care</a></nav>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Settings - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/workspace.css">
    <link rel="stylesheet" href="/assets/app/general-location.css">
    <link rel="stylesheet" href="/assets/app/clock-settings.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
    <link rel="stylesheet" href="/assets/app/help/manual.css">
    <meta name="presentation-folder-order" content="${escapeHtml(JSON.stringify(display.selectedFolderIds))}">
    <meta name="presentation-order-mode" content="${escapeHtml(display.orderMode)}">
  </head>
  <body><main>
    <aside><div class="brand">${renderLogo(156)}</div><nav>${validSections.map((section) => `<button type="button" data-section="${section}"${section === activeSection ? " class=\"active\"" : ""}>${sectionLabel(section)}</button>`).join("")}</nav>${helpContents}<div class="rail-footer"><a href="/display">Open frame</a></div></aside>
    <section class="content"><header class="top"><div><h2 id="section-title">${sectionLabel(activeSection)}</h2></div></header>${renderFlash(flash)}
      <section class="panel" data-panel="dashboard"${activeSection === "dashboard" ? "" : " hidden"}><div class="dashboard-grid"><section class="card dashboard-lead"><p>${displayOn ? "Displaying now" : "Display is off"}</p><h3>${displayOn ? stats.ready > 0 ? "Your frame is on." : "Waiting for photos." : "Resting quietly."}</h3><p>${displayOn ? `${stats.ready.toString()} ready photo${stats.ready === 1 ? "" : "s"} are available for display.` : "The schedule or an override has set the display to black."}</p><div class="dashboard-actions"><a href="/display">Open frame</a><a class="secondary" href="/?view=folders">Manage albums</a></div></section><section class="card"><h3>Frame setup</h3><dl><div><dt>Source</dt><dd>${display.selectedFolderIds.length === 0 ? "All albums" : `${display.selectedFolderIds.length.toString()} selected`}</dd></div><div><dt>Layout</dt><dd>${display.screenLayout === "single" ? "One photo" : "Adaptive"}</dd></div><div><dt>Change every</dt><dd>${display.photoDurationSeconds.toString()} seconds</dd></div><div><dt>Schedule</dt><dd>${displayOn ? "On" : "Off"}</dd></div></dl></section></div><section class="card" style="margin-top:16px"><h3>Library health</h3><div class="stats"><div class="stat"><strong>${stats.total.toString()}</strong><span>Photos</span></div><div class="stat"><strong>${stats.ready.toString()}</strong><span>Ready</span></div><div class="stat"><strong>${(stats.pending + stats.processing + stats.failed).toString()}</strong><span>Need attention</span></div></div></section></section>
      <section class="panel" data-panel="general"${activeSection === "general" ? "" : " hidden"}>${renderGeneralSettingsPanel(frame)}</section>
      <section class="panel" data-panel="presentation"${activeSection === "presentation" ? "" : " hidden"}><div class="card"><form method="post" action="/admin/presentation/save"><section class="section"><h3>Photo source</h3><label><input id="all-folders" type="checkbox" name="useAllFolders"${allFolders ? " checked" : ""}> Use all albums</label><div id="folder-choices" class="folders">${folderChecks}</div></section><section class="section"><h3>Playback</h3><label class="inline-field"><span>Seconds per photo:</span><input type="number" name="photoDurationSeconds" min="3" max="3600" value="${display.photoDurationSeconds.toString()}" required></label><label class="inline-field"><span>Ordering:</span><select name="orderMode"><option value="random"${display.orderMode === "random" ? " selected" : ""}>Random</option><option value="filename-asc"${display.orderMode === "filename-asc" ? " selected" : ""}>Filename A-Z</option><option value="filename-desc"${display.orderMode === "filename-desc" ? " selected" : ""}>Filename Z-A</option><option value="upload-newest"${display.orderMode === "upload-newest" ? " selected" : ""}>Newest upload first</option><option value="upload-oldest"${display.orderMode === "upload-oldest" ? " selected" : ""}>Oldest upload first</option></select></label><label class="inline-field"><span>Layout:</span><select name="screenLayout"><option value="single"${display.screenLayout === "single" ? " selected" : ""}>One photo</option><option value="multiple"${display.screenLayout !== "single" ? " selected" : ""}>Adaptive</option></select></label></section><section class="section"><h3>Appearance</h3><label class="inline-field"><span>Image sizing:</span><select name="imagePresentationMode"><option value="fit"${display.imagePresentationMode !== "fill" ? " selected" : ""}>Fit entire photo</option><option value="fill"${display.imagePresentationMode === "fill" ? " selected" : ""}>Fill screen and crop edges</option></select></label><label><input type="checkbox" name="clockEnabled"${display.clockEnabled ? " checked" : ""}> Show clock</label><label class="field">Clock format<select name="clockFormat"><option value="locale-default"${display.clockFormat === "locale-default" ? " selected" : ""}>Device default</option><option value="12h"${display.clockFormat === "12h" ? " selected" : ""}>12-hour</option><option value="24h"${display.clockFormat === "24h" ? " selected" : ""}>24-hour</option></select></label><label class="field">Clock size<select name="clockSize"><option value="small"${display.clockSize === "small" ? " selected" : ""}>Small</option><option value="medium"${display.clockSize === "medium" ? " selected" : ""}>Medium</option><option value="large"${display.clockSize === "large" ? " selected" : ""}>Large</option></select></label><label><input type="checkbox" name="clockShowDate"${display.clockShowDate ? " checked" : ""}> Show date</label><label><input type="checkbox" name="weatherEnabled"${display.weatherEnabled ? " checked" : ""}> Show weather</label><label><input type="checkbox" name="weatherShowCurrent"${display.weatherShowCurrent ? " checked" : ""}> Current conditions</label><label><input type="checkbox" name="weatherShowForecast"${display.weatherShowForecast ? " checked" : ""}> 5-day forecast</label><label class="field">Weather units<select name="weatherUnits"><option value="imperial"${display.weatherUnits === "imperial" ? " selected" : ""}>Imperial (°F, mph)</option><option value="metric"${display.weatherUnits === "metric" ? " selected" : ""}>Metric (°C, km/h)</option></select></label></section><button class="save" type="submit">Save presentation settings</button></form></div></section>
      <section class="panel" data-panel="schedule"${activeSection === "schedule" ? "" : " hidden"}><div class="card"><form method="post" action="/admin/schedule/save"><section class="section"><h3>Daily display schedule</h3><p class="muted">Off time uses a black screen. The schedule follows the frame's local time.</p><label><input type="checkbox" name="enabled"${schedule.enabled ? " checked" : ""}> Follow a daily schedule</label><div class="times"><label class="field">Turn on<input type="time" name="dailyOnTime" value="${escapeHtml(schedule.dailyOnTime)}" required></label><label class="field">Turn off<input type="time" name="dailyOffTime" value="${escapeHtml(schedule.dailyOffTime)}" required></label></div></section><section class="section"><label class="field">Override<select name="overrideState"><option value="follow-schedule"${schedule.overrideState === "follow-schedule" ? " selected" : ""}>Follow schedule</option><option value="force-on"${schedule.overrideState === "force-on" ? " selected" : ""}>Force frame on</option><option value="force-off"${schedule.overrideState === "force-off" ? " selected" : ""}>Force frame off</option></select></label></section><button class="save" type="submit">Save schedule</button></form></div></section>
      <section class="panel" data-panel="folders"${activeSection === "folders" ? "" : " hidden"}><div class="card"><section><h3>Albums</h3><div class="folder-list">${folderList}</div></section></div></section>
      <section class="panel" data-panel="status"${activeSection === "status" ? "" : " hidden"}><section class="card"><h3>System</h3>${systemDetails}</section><section class="card" style="margin-top:16px"><h3>Storage</h3>${storageDetails}</section>${systemActionControls}<section class="card" style="margin-top:16px"><h3>Recent activity</h3>${eventRows}</section></section>
      <section class="panel help-panel" data-panel="help"${activeSection === "help" ? "" : " hidden"}><div id="help-content" class="help-content" aria-live="polite">Loading help…</div></section>
    </section>
    <dialog id="about-dialog"><section class="about">${renderLogo(180)}<h3 style="margin-top:22px">About PiFrame</h3><p>PiFrame is a local-first digital picture frame for Raspberry Pi and desktop development. It stores albums and photos locally, prepares display-ready assets, and runs without a cloud service.</p><p><strong>Version 0.1.0</strong><br>Node.js, TypeScript, SQLite, and Chromium kiosk mode.</p><p class="attribution">Location search uses Open-Meteo. Reverse geocoding data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, via Nominatim.</p><button id="about-close" type="button">Close</button></section></dialog>
    <script>
      const buttons = document.querySelectorAll("[data-section]"); const panels = document.querySelectorAll("[data-panel]"); const title = document.querySelector("#section-title"); const allFolders = document.querySelector("#all-folders"); const folderChoices = document.querySelector("#folder-choices"); const about = document.querySelector("#about-dialog"); const helpToc = document.querySelector("#help-toc"); const helpContent = document.querySelector("#help-content"); const labels = { dashboard: "Dashboard", general: "Frame", presentation: "Presentation", schedule: "Schedule", folders: "Albums", status: "System Status", help: "Help" }; const layoutSelect = document.querySelector("select[name=screenLayout]"); if (layoutSelect) { const adaptiveOption = layoutSelect.querySelector("option[value=multiple]"); if (adaptiveOption) { adaptiveOption.value = "triple"; adaptiveOption.textContent = "Three photos"; } const layoutTerm = Array.from(document.querySelectorAll("dt")).find((term) => term.textContent === "Layout"); if (layoutTerm?.nextElementSibling) layoutTerm.nextElementSibling.textContent = layoutSelect.value === "single" ? "One photo" : "Three photos"; }
      if (layoutSelect) { const restoredOption = layoutSelect.querySelector("option[value=triple]"); if (restoredOption) { restoredOption.value = "multiple"; restoredOption.textContent = "Adaptive"; } const layoutTerm = Array.from(document.querySelectorAll("dt")).find((term) => term.textContent === "Layout"); if (layoutTerm?.nextElementSibling) layoutTerm.nextElementSibling.textContent = layoutSelect.value === "single" ? "One photo" : "Adaptive"; }
      function selectSection(section) { buttons.forEach((button) => button.classList.toggle("active", button.dataset.section === section)); panels.forEach((panel) => panel.hidden = panel.dataset.panel !== section); if (helpToc) helpToc.hidden = section !== "help"; title.textContent = labels[section] || section; history.replaceState(null, "", "/?view=" + section); }
      buttons.forEach((button) => button.addEventListener("click", () => selectSection(button.dataset.section)));
      if (helpContent) fetch("/help").then((response) => { if (!response.ok) throw new Error("Could not load help."); return response.text(); }).then((markup) => { const documentFragment = new DOMParser().parseFromString(markup, "text/html"); const manual = documentFragment.querySelector(".shell main"); if (!manual) throw new Error("Help content was invalid."); helpContent.replaceChildren(...manual.children); }).catch(() => { helpContent.textContent = "Help could not be loaded. Refresh and try again."; });
      helpToc?.querySelectorAll("[data-help-section]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); const target = helpContent?.querySelector("#" + link.dataset.helpSection); target?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
      function syncFolders() { if (!allFolders || !folderChoices) return; folderChoices.style.opacity = allFolders.checked ? ".5" : "1"; folderChoices.querySelectorAll("input").forEach((input) => input.disabled = allFolders.checked); } if (allFolders) { allFolders.addEventListener("change", syncFolders); syncFolders(); }
      document.querySelectorAll(".piframe-logo").forEach((logo) => logo.addEventListener("click", (event) => { event.preventDefault(); about.showModal(); })); document.querySelector("#about-close").addEventListener("click", () => about.close()); if (new URLSearchParams(location.search).has("about")) about.showModal();
    </script>
    <script>
      (() => {
        const form = document.querySelector('form[action="/admin/presentation/save"]');
        if (!form) return;
        const select = form.querySelector('select[name="orderMode"]');
        const mode = document.querySelector('meta[name="presentation-order-mode"]')?.content;
        if (select && !select.querySelector('option[value="manual"]')) {
          const option = document.createElement("option"); option.value = "manual"; option.textContent = "Manual album order"; select.append(option);
        }
        if (select && mode === "manual") select.value = "manual";
        const orderInput = document.createElement("input"); orderInput.type = "hidden"; orderInput.name = "folderOrder";
        try { orderInput.value = document.querySelector('meta[name="presentation-folder-order"]')?.content || "[]"; } catch { orderInput.value = "[]"; }
        form.append(orderInput);
        let order; try { order = JSON.parse(orderInput.value); } catch { order = []; }
        if (!Array.isArray(order)) order = [];
        const folderInputs = [...form.querySelectorAll('#folder-choices input[type="checkbox"]')];
        folderInputs.forEach((input) => input.addEventListener("change", () => {
          const folderId = input.name.replace(/^folder-/, "");
          order = order.filter((id) => id !== folderId);
          if (input.checked) order.push(folderId);
          orderInput.value = JSON.stringify(order);
        }));
        form.addEventListener("submit", () => {
          const selected = new Set(folderInputs.filter((input) => input.checked).map((input) => input.name.replace(/^folder-/, "")));
          orderInput.value = JSON.stringify([...order.filter((id) => selected.has(id)), ...[...selected].filter((id) => !order.includes(id))]);
        });
        const layoutField = form.querySelector('select[name="screenLayout"]')?.closest("label");
        if (layoutField && !form.querySelector('select[name="transitionStyle"]')) {
          const transitionStyle = ${JSON.stringify(display.transitionStyle)};
          const transitionDuration = ${display.transitionDurationSeconds.toString()};
          const transitionOptions = [["none", "No transition"], ["crossfade", "Crossfade"], ["fade-black", "Fade through black"], ["slide-left", "Swipe left"], ["slide-right", "Swipe right"], ["slow-pan", "Gentle zoom"]]
            .map(([value, label]) => "<option value='" + value + "'" + (value === transitionStyle ? " selected" : "") + ">" + label + "</option>").join("");
          const transitionFields = document.createElement("div");
          transitionFields.className = "transition-fields";
          transitionFields.innerHTML = "<label class='inline-field'><span>Transition:</span><select name='transitionStyle'>" + transitionOptions + "</select></label><label class='inline-field'><span>Transition duration:</span><input type='number' name='transitionDurationSeconds' min='0.2' max='3' step='0.1' value='" + transitionDuration.toString() + "' required></label>";
          layoutField.insertAdjacentElement("afterend", transitionFields);
        }
      })();
    </script>
    <script>
      (() => {
        const form = document.querySelector('form[action="/admin/presentation/save"]');
        const enabled = form?.querySelector('input[name="clockEnabled"]');
        const format = form?.querySelector('select[name="clockFormat"]');
        const size = form?.querySelector('select[name="clockSize"]');
        const date = form?.querySelector('input[name="clockShowDate"]');
        const section = enabled?.closest(".section");
        if (!enabled || !format || !size || !date || !section) return;

        const originalLabels = [enabled, format, size, date].map((control) => control.closest("label")).filter(Boolean);
        const settings = document.createElement("div"); settings.className = "clock-settings";
        section.insertBefore(settings, originalLabels[0] || null);

        const enabledLabel = document.createElement("label"); enabledLabel.className = "clock-enabled";
        enabledLabel.append(enabled, document.createTextNode(" Show clock"));
        const options = document.createElement("div"); options.className = "clock-options";
        const makeRow = (caption, control) => { const row = document.createElement("label"); row.className = "clock-row"; const title = document.createElement("span"); title.textContent = caption; row.append(title, control); return row; };
        const toggles = document.createElement("span"); toggles.className = "clock-toggles";
        const dateLabel = document.createElement("label"); dateLabel.append(date, document.createTextNode(" Date"));
        toggles.append(dateLabel);
        options.append(makeRow("Format:", format), makeRow("Size:", size), makeRow("Show:", toggles));
        settings.append(enabledLabel, options);
        originalLabels.forEach((label) => label.remove());

        const syncClockOptions = () => { options.hidden = !enabled.checked; };
        enabled.addEventListener("change", syncClockOptions);
        syncClockOptions();
      })();
    </script>
    <script>
      (() => {
        const form = document.querySelector('form[action="/admin/presentation/save"]');
        const enabled = form?.querySelector('input[name="weatherEnabled"]');
        const current = form?.querySelector('input[name="weatherShowCurrent"]');
        const forecast = form?.querySelector('input[name="weatherShowForecast"]');
        const units = form?.querySelector('select[name="weatherUnits"]');
        const section = enabled?.closest(".section");
        if (!enabled || !current || !forecast || !units || !section) return;

        const originalLabels = [enabled, current, forecast, units].map((control) => control.closest("label")).filter(Boolean);
        const settings = document.createElement("div"); settings.className = "weather-settings";
        section.insertBefore(settings, originalLabels[0] || null);
        const enabledLabel = document.createElement("label"); enabledLabel.className = "weather-enabled";
        enabledLabel.append(enabled, document.createTextNode(" Show weather"));
        const options = document.createElement("div"); options.className = "weather-options";
        const choices = document.createElement("span"); choices.className = "weather-toggles";
        const currentLabel = document.createElement("label"); currentLabel.append(current, document.createTextNode(" Current conditions"));
        const forecastLabel = document.createElement("label"); forecastLabel.append(forecast, document.createTextNode(" 5-day forecast"));
        choices.append(currentLabel, forecastLabel);
        const unitRow = document.createElement("label"); unitRow.className = "clock-row"; const title = document.createElement("span"); title.textContent = "Units:"; unitRow.append(title, units);
        options.append(choices, unitRow);
        settings.append(enabledLabel, options);
        originalLabels.forEach((label) => label.remove());
        const syncWeatherOptions = () => { options.hidden = !enabled.checked; };
        enabled.addEventListener("change", syncWeatherOptions);
        syncWeatherOptions();
      })();
    </script>
  </main></body>
</html>`;
}

export function renderFoldersPage(context: AppContext, flash: FlashMessage): string {
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
    <link rel="stylesheet" href="/assets/app/albums.css">
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
  <td><div class="photo-name${nameState}">${photo.processingStatus === "ready" ? `<img src="/media/thumbnail/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" alt="">` : ""}<span title="${escapeHtml(nameTitle)}">${escapeHtml(displayName)}</span></div></td>
  <td>${photo.widthPx && photo.heightPx ? `${photo.widthPx.toString()} x ${photo.heightPx.toString()}` : "Unknown"}</td>
  <td>${formatBytes(photo.fileSizeBytes)}</td>
  <td><div class="photo-actions">${photo.processingStatus === "failed" ? `<form method="post" action="/admin/photos/retry"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><button type="submit" aria-label="Retry ${escapeHtml(photo.originalFilename)}" title="Retry processing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5m-2-5V5m0 6h-6"/></svg></button></form>` : ""}<form method="post" action="/admin/photos/rotation"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><input type="hidden" name="rotation" value="${rotateLeft.toString()}"><button type="submit" aria-label="Rotate ${escapeHtml(photo.originalFilename)} left" title="Rotate left"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg></button></form><form method="post" action="/admin/photos/rotation"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><input type="hidden" name="rotation" value="${rotateRight.toString()}"><button type="submit" aria-label="Rotate ${escapeHtml(photo.originalFilename)} right" title="Rotate right"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg></button></form><form method="post" action="/admin/photos/delete" class="delete-form"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input type="hidden" name="photoId" value="${escapeHtml(photo.id)}"><button type="submit" aria-label="Delete ${escapeHtml(photo.originalFilename)}" title="Delete photo" onclick="return confirm('Delete this photo and its managed files?');"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13"/></svg></button></form></div></td>
</tr>`;
    }).join("\n");
  const photoGrid = photos.length === 0
    ? `<p class="empty">No photos in this album yet.</p>`
    : `<div class="photo-grid" data-folder-id="${escapeHtml(folder.id)}">${photos.map((photo) => `<article class="photo-tile" data-photo-id="${escapeHtml(photo.id)}" data-photo-name="${escapeHtml(photo.originalFilename)}" data-photo-created-at="${escapeHtml(photo.createdAt)}">${photo.processingStatus === "ready" ? `<img src="/media/thumbnail/${photo.id}.jpg?v=${encodeURIComponent(photo.updatedAt)}" alt="${escapeHtml(photo.originalFilename)}">` : `<div class="photo-placeholder">${escapeHtml(photo.processingStatus)}</div>`}<p title="${escapeHtml(photo.originalFilename)}">${escapeHtml(photo.originalFilename)}</p></article>`).join("")}</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(folder.name)} photos - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/album.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
  </head>
  <body><main>
    <aside><div class="brand">${renderLogo(156)}</div><nav><a href="/">Dashboard</a><a href="/?view=general">Frame</a><a href="/?view=presentation">Presentation</a><a href="/?view=schedule">Schedule</a><a class="album-nested" href="/?view=folders">Albums<small>${escapeHtml(folder.name)}</small></a><a href="/?view=status">System Status</a><a href="/?view=help">Help</a></nav><div class="rail-footer"><a href="/display">Open frame</a></div></aside>
    <section class="content"><header class="top"><div><p class="eyebrow">Albums</p><h1>${escapeHtml(folder.name)}</h1></div><a class="back-link" href="/?view=folders">Back to albums</a></header>
      ${renderFlash(flash)}
      
      
      
      <section class="panel"><h2>Upload photos</h2><form id="batch-upload-form" class="upload-form" method="post" action="/admin/photos/upload" enctype="multipart/form-data"><input type="hidden" name="folderId" value="${escapeHtml(folder.id)}"><input id="batch-photo-input" type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif,image/heif" aria-label="Choose photos" multiple onchange="window.preflightDuplicateFiles(this.files)"><button id="batch-upload-button" class="batch-upload-button" type="submit" disabled>Upload</button><button id="clear-upload-queue" class="clear-queue-button" type="button" disabled>Clear</button><p id="batch-upload-help" class="upload-help">No photos in queue.</p></form><ul id="upload-queue" class="upload-queue" hidden></ul></section><script src="/assets/app/album-queue.js" defer></script>
      <section class="panel photos-panel"><div class="photos-head"><h2>Photos (${photos.length.toString()})</h2><div class="photo-controls"><label class="photo-sort">Sort <select id="photo-sort"><option value="manual">Manual</option><option value="date">Upload date (newest first)</option><option value="alphabetical">Alphabetical</option></select></label><div class="view-switch" aria-label="Photo view"><button type="button" class="active" data-photo-view-button="detail">Detail</button><button type="button" data-photo-view-button="grid">Grid</button></div></div></div><p id="photo-order-status" class="photo-order-status" aria-live="polite"></p><section class="photo-view" data-photo-view="detail"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Dimensions</th><th>Size</th><th>Actions</th></tr></thead><tbody>${photoRows}</tbody></table></div></section><section class="photo-view" data-photo-view="grid" hidden>${photoGrid}</section></section>
    </section>
    <script src="/assets/app/album-interactions.js" defer></script>
  </main></body>
</html>`;
}

export function renderDisplaySettingsPage(context: AppContext, flash: FlashMessage): string {
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
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Display Settings - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/display-settings.css">
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
      <section><h2>Presentation</h2><label class="field">Image sizing<select name="imagePresentationMode"><option value="fit"${fitSelected}>Fit entire photo</option><option value="fill"${fillSelected}>Fill screen, crop edges</option></select></label></section>
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
  const settings = context.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Schedule - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/schedule-settings.css">
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

export function renderUploadConflictPage(folderId: string, folderName: string, staged: StagedUpload, existingFilename: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Resolve filename conflict - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/upload-conflict.css">
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
    <link rel="stylesheet" href="/assets/app/status.css">
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
