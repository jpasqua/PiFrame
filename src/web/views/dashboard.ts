import { createDefaultDisplaySettings, createDefaultScheduleSettings, type DisplaySettings, type ScheduleSettings } from "../../core/settings.js";
import type { AppContext } from "../../data/app-context.js";
import { isDisplayOn } from "../display-state.js";
import { folderPhotosPath } from "../urls.js";
import { escapeHtml, formatTimestamp, renderLogo } from "./shared.js";

export function renderHomePage(context: AppContext): string {
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

