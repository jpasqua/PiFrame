import type { DisplaySettings } from "../../../core/settings.js";
import type { PhotoStats } from "../../../data/photo-repository.js";

export function renderDashboardPanel(active: boolean, display: DisplaySettings, stats: PhotoStats, displayOn: boolean, showOpenFrame: boolean): string {
  const message = displayOn ? `${stats.ready} ready photo${stats.ready === 1 ? "" : "s"} are available for display.` : "The schedule or an override has set the display to black.";
  const actions = `${showOpenFrame ? '<a href="/display">Open frame</a>' : ""}<a class="secondary" href="/?view=folders">Manage albums</a>`;
  return `<section class="panel" data-panel="dashboard"${active ? "" : " hidden"}>
  <div class="dashboard-grid" data-dashboard-ready="${stats.ready}">
    <section class="card dashboard-lead"><p id="dashboard-display-status">${displayOn ? "Displaying now" : "Display is off"}</p><h3 id="dashboard-display-heading">${displayOn ? stats.ready > 0 ? "Your frame is on." : "Waiting for photos." : "Resting quietly."}</h3><p id="dashboard-display-message">${message}</p><div class="dashboard-actions">${actions}</div></section>
    <section class="card"><h3>Frame setup</h3><dl class="frame-setup"><div><dt>Source:</dt><dd>${display.selectedFolderIds.length === 0 ? "All albums" : `${display.selectedFolderIds.length} selected`}</dd></div><div><dt>Layout:</dt><dd>${display.screenLayout === "single" ? "One photo" : "Adaptive"}</dd></div><div><dt>Change every:</dt><dd>${display.photoDurationSeconds} seconds</dd></div><div><dt>Schedule:</dt><dd id="dashboard-schedule-state">${displayOn ? "On" : "Off"}</dd></div></dl></section>
  </div>
  <section class="card" style="margin-top:16px"><h3>Library health</h3><div class="stats"><div class="stat"><strong>${stats.total}</strong><span>Photos</span></div><div class="stat"><strong>${stats.ready}</strong><span>Ready</span></div><div class="stat"><strong>${stats.pending + stats.processing + stats.failed}</strong><span>Need attention</span></div></div></section>
</section>`;
}
