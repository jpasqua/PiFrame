import type { DisplaySettings } from "../../core/settings.js";
import { renderLogo } from "./shared.js";

export function renderDisplayPage(settings: DisplaySettings): string {
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

