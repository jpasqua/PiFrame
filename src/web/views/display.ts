import type { DisplaySettings, FrameSettings } from "../../core/settings.js";
import { renderLogo } from "./shared.js";

export function renderDisplayPage(settings: DisplaySettings, frame: FrameSettings): string {
  const durationMs = Math.max(1_000, Math.round(settings.photoDurationSeconds * 1_000));
  const presentation = settings.imagePresentationMode === "fill" ? "cover" : "contain";
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
      main { width:100vw; height:100vh; display:grid; place-items:center; background:#000; }
      #display-surface { position:relative; display:grid; place-items:center; overflow:hidden; background:#000; border:5px solid #fff; }
      main.orientation-0 #display-surface, main.orientation-180 #display-surface { width:min(100vw, calc(100vh * 16 / 9)); height:min(100vh, calc(100vw * 9 / 16)); }
      main.orientation-90 #display-surface, main.orientation-270 #display-surface { width:min(100vw, calc(100vh * 9 / 16)); height:min(100vh, calc(100vw * 16 / 9)); }
      #stage { position:absolute; inset:0; display:grid; grid-template-columns:1fr; gap:0; background:#000; }
      #stage.portrait-pair { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:4px; }
      #stage.landscape-pair { grid-template-rows:repeat(2, minmax(0, 1fr)); gap:4px; }
      #stage.landscape-trio { grid-template-columns:repeat(2, minmax(0, 1fr)); grid-template-rows:.78fr 1.22fr; gap:4px; }
      #stage.landscape-trio .photo-panel:first-child { grid-column:1 / -1; }
      #stage.portrait-trio { grid-template-columns:repeat(2, minmax(0, 1fr)); grid-template-rows:1.18fr .82fr; gap:4px; }
      #stage.portrait-trio .photo-panel:last-child { grid-column:1 / -1; }
      .photo-panel { position:relative; min-width:0; min-height:0; margin:0; overflow:hidden; background:#000; }
      .photo-panel::before { content:""; position:absolute; inset:-7%; background:var(--photo-background) center / cover no-repeat; filter:blur(28px); transform:scale(1.08); opacity:.72; transition:opacity 900ms ease; }
      img { position:relative; z-index:1; width:100%; height:100%; min-width:0; object-fit:${presentation}; opacity:0; transition:opacity 900ms ease; background:transparent; }
      #stage:not(.single) img { object-fit:contain; }
      img.visible { opacity:1; } #empty { position:relative; z-index:1; max-width:32rem; padding:2rem; text-align:center; color:#bdb6aa; line-height:1.6; }
      #clock { position:absolute; z-index:10; left:22px; top:18px; margin:0; color:rgba(255,255,255,.92); font-size:${clockSize}; font-variant-numeric:tabular-nums; letter-spacing:.03em; text-shadow:0 2px 5px #000; }
    </style>
  </head>
  <body>
    <main class="orientation-${frame.displayOrientation.toString()}">
      <section id="display-surface">
        <div style="position:absolute;left:20px;top:18px;z-index:2">${renderLogo(128)}</div>
        <section id="stage" class="single"><figure class="photo-panel"><img alt=""></figure><figure class="photo-panel"><img alt=""></figure><figure class="photo-panel"><img alt=""></figure></section>
        <p id="empty">Waiting for a ready photo. Upload images from the local administration page.</p>
        ${settings.clockEnabled ? `<time id="clock"></time>` : ""}
      </section>
    </main>
    <script>
      const durationMs = ${durationMs.toString()};
      const stage = document.querySelector("#stage");
      const displaySurface = document.querySelector("#display-surface");
      const panels = Array.from(stage.querySelectorAll(".photo-panel"));
      const empty = document.querySelector("#empty");
      const clock = document.querySelector("#clock");
      let currentId = "";
      let scheduleOff = false;
      let advanceTimer = null;

      function scheduleAdvance(delay) {
        if (advanceTimer) clearTimeout(advanceTimer);
        advanceTimer = setTimeout(advance, delay);
      }

      function hideDisplay() {
        displaySurface.hidden = true;
      }

      function updateClock() {
        if (!clock) return;
        const date = new Date();
        const timeOptions = { hour: "numeric", minute: "2-digit"${settings.clockShowSeconds ? ', second: "2-digit"' : ""}${settings.clockFormat === "12h" ? ", hour12: true" : settings.clockFormat === "24h" ? ", hour12: false" : ""} };
        const time = new Intl.DateTimeFormat(${JSON.stringify(frame.language)}, { ...timeOptions, timeZone: ${JSON.stringify(frame.timeZone)} }).format(date);
        const day = ${settings.clockShowDate ? `new Intl.DateTimeFormat(${JSON.stringify(frame.language)}, { timeZone: ${JSON.stringify(frame.timeZone)}, weekday: "short", month: "short", day: "numeric" }).format(date)` : '""'};
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
            displaySurface.hidden = false;
            stage.hidden = true;
            empty.hidden = false;
            scheduleAdvance(Math.min(durationMs, 5000));
            return;
          }
          const nextPhotos = payload.photos.slice(0, 3);
          await Promise.all(nextPhotos.map((photo) => new Promise((resolve, reject) => {
            const preloaded = new Image();
            preloaded.onload = resolve;
            preloaded.onerror = reject;
            preloaded.src = photo.src;
          })));
          displaySurface.hidden = false;
          stage.hidden = false;
          stage.className = payload.layout || "single";
          panels.forEach((panel, index) => {
            const image = panel.querySelector("img");
            const photo = nextPhotos[index];
            if (!image) return;
            if (!photo) {
              image.classList.remove("visible");
              image.removeAttribute("src");
              panel.hidden = true;
              panel.style.removeProperty("--photo-background");
              return;
            }
            panel.hidden = false;
            panel.style.setProperty("--photo-background", "url('" + photo.src + "')");
            image.src = photo.src;
            image.alt = photo.alt;
            image.classList.add("visible");
          });
          empty.hidden = true;
          currentId = payload.cursor || nextPhotos[nextPhotos.length - 1].id;
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
