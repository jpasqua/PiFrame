import type { DisplaySettings, FrameSettings } from "../../../core/settings.js";
import type { PhotoStats } from "../../../data/photo-repository.js";
import { escapeHtml } from "../shared.js";

export function renderDashboardPanel(active: boolean, display: DisplaySettings, frame: FrameSettings, stats: PhotoStats, albumCount: number, displayOn: boolean): string {
  const coordinates = frame.weatherLocation
    ? `${frame.weatherLocation.latitude.toFixed(5)}, ${frame.weatherLocation.longitude.toFixed(5)}`
    : "Not set";
  const language = frame.language === "en-US" ? "English (United States)" : frame.language;
  const displayStatus = displayOn ? "on" : "off";
  return `<section class="panel" data-panel="dashboard"${active ? "" : " hidden"}>
  <div class="dashboard-grid">
    <section class="card dashboard-lead"><p id="dashboard-display-status" class="dashboard-status is-${displayStatus}"><span class="dashboard-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 2v10"></path><path d="M6.2 5.3a8 8 0 1 0 11.6 0"></path></svg></span><span class="dashboard-status-text">Display is ${displayStatus}.</span></p></section>
    <section class="card"><h3>Locale</h3><dl class="frame-setup"><div><dt>Location:</dt><dd>${escapeHtml(frame.location || "Not set")}</dd></div><div><dt>Lat/Lon:</dt><dd>${coordinates}</dd></div><div><dt>Time Zone:</dt><dd>${escapeHtml(frame.timeZone)}</dd></div><div><dt>Language:</dt><dd>${escapeHtml(language)}</dd></div></dl></section>
    <section class="card"><h3>Presentation Options</h3><dl class="frame-setup"><div><dt>Albums:</dt><dd>${display.selectedFolderIds.length === 0 ? "All albums" : `${display.selectedFolderIds.length} selected`}</dd></div><div><dt>Layout:</dt><dd>${display.screenLayout === "single" ? "One photo" : "Adaptive"}</dd></div><div><dt>Change every:</dt><dd>${display.photoDurationSeconds} seconds</dd></div><div><dt>Schedule:</dt><dd id="dashboard-schedule-state">${displayOn ? "On" : "Off"}</dd></div></dl></section>
  </div>
  <section class="card" style="margin-top:16px"><h3>Library health</h3><div class="stats dashboard-library-stats"><div class="stat"><strong>${albumCount}</strong><span>Albums</span></div><div class="stat"><strong>${stats.total}</strong><span>Photos</span></div><div class="stat"><strong>${stats.ready}</strong><span>Ready</span></div><div class="stat"><strong>${stats.pending + stats.processing + stats.failed}</strong><span>Need attention</span></div></div></section>
</section>`;
}
