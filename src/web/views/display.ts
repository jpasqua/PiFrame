import type { DisplaySettings, FrameSettings } from "../../core/settings.js";

export function renderDisplayPage(settings: DisplaySettings, frame: FrameSettings, presentationVersion: string): string {
  const durationMs = Math.max(1_000, Math.round(settings.photoDurationSeconds * 1_000));
  const transitionMs = Math.round(Math.min(3, Math.max(.2, settings.transitionDurationSeconds)) * 1_000);
  const presentation = settings.imagePresentationMode === "fill" ? "cover" : "contain";
  const clockSize = { small: "1rem", medium: "1.6rem", large: "2.4rem" }[settings.clockSize] ?? "1.6rem";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PiFrame Display</title>
    <style>
      :root { color-scheme:dark; background:#000; } * { box-sizing:border-box; }
      html, body, body * { cursor:none !important; }
      body { margin:0; overflow:hidden; background:#000; color:#fff; font-family:Georgia,serif; }
      main { width:100vw; height:100vh; display:grid; place-items:center; background:#000; }
      #display-surface { position:relative; display:grid; place-items:center; overflow:hidden; background:#000; border:1px solid #fff; }
      #display-surface[hidden] { display:none; }
      main.orientation-0 #display-surface, main.orientation-180 #display-surface { width:min(100vw,calc(100vh * 16 / 9)); height:min(100vh,calc(100vw * 9 / 16)); }
      main.orientation-90 #display-surface, main.orientation-270 #display-surface { width:min(100vw,calc(100vh * 9 / 16)); height:min(100vh,calc(100vw * 16 / 9)); }
      #stage-host { position:absolute; inset:0; overflow:hidden; background:#000; }
      .stage { position:absolute; inset:0; display:grid; grid-template-columns:1fr; gap:0; background:#000; will-change:opacity,transform; }
      .stage.portrait-pair { grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.landscape-pair { grid-template-rows:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.landscape-side-pair { grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.portrait-triptych { grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }
      .stage.landscape-trio { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:.78fr 1.22fr; gap:4px; }
      .stage.landscape-trio .photo-panel:first-child { grid-column:1 / -1; }
      .stage.portrait-trio { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:1.18fr .82fr; gap:4px; }
      .stage.portrait-trio .photo-panel:last-child { grid-column:1 / -1; }
      .photo-panel { position:relative; min-width:0; min-height:0; margin:0; overflow:hidden; background:#000; }
      .photo-panel::before { content:""; position:absolute; inset:-7%; background:var(--photo-background) center / cover no-repeat; filter:blur(28px); transform:scale(1.08); opacity:.72; }
      img { position:relative; z-index:1; display:block; width:100%; height:100%; min-width:0; object-fit:${presentation}; background:transparent; }
      .stage:not(.single) img { object-fit:contain; }
      #empty { position:relative; z-index:1; max-width:32rem; padding:2rem; text-align:center; color:#bdb6aa; line-height:1.6; }
      #clock { position:absolute; z-index:10; left:22px; top:18px; margin:0; color:rgba(255,255,255,.92); font-size:${clockSize}; font-variant-numeric:tabular-nums; letter-spacing:.03em; text-shadow:0 2px 5px #000; }
      @media (prefers-reduced-motion:reduce) { .stage { transition:none !important; } }
    </style>
  </head>
  <body>
    <main class="orientation-${frame.displayOrientation.toString()}">
      <section id="display-surface">
        <section id="stage-host"></section>
        <p id="empty">Waiting for a ready photo. Upload images from the local administration page.</p>
        ${settings.clockEnabled ? `<time id="clock"></time>` : ""}
      </section>
    </main>
    <script>
      const durationMs = ${durationMs.toString()};
      const transitionMs = ${transitionMs.toString()};
      const transitionStyle = ${JSON.stringify(settings.transitionStyle)};
      const presentationVersion = ${JSON.stringify(presentationVersion)};
      const displaySession = sessionStorage.getItem("piframe-display-session") || crypto.randomUUID();
      sessionStorage.setItem("piframe-display-session", displaySession);
      const stageHost = document.querySelector("#stage-host");
      const displaySurface = document.querySelector("#display-surface");
      const empty = document.querySelector("#empty");
      const clock = document.querySelector("#clock");
      let currentStage = null;
      let currentId = "";
      let scheduleOff = false;
      let advanceTimer = null;
      let advancing = false;

      function scheduleAdvance(delay) {
        if (advanceTimer) clearTimeout(advanceTimer);
        advanceTimer = setTimeout(advance, delay);
      }

      function wait(delay) { return new Promise((resolve) => setTimeout(resolve, delay)); }

      function clearStages() {
        stageHost.replaceChildren();
        currentStage = null;
      }

      function hideDisplay() {
        displaySurface.hidden = true;
      }

      function createStage(layout, photos) {
        const stage = document.createElement("section");
        stage.className = "stage " + (layout || "single");
        stage.style.opacity = "0";
        for (let index = 0; index < 3; index += 1) {
          const panel = document.createElement("figure");
          panel.className = "photo-panel";
          const photo = photos[index];
          if (!photo) {
            panel.hidden = true;
          } else {
            panel.style.setProperty("--photo-background", "url('" + photo.src + "')");
            const image = document.createElement("img");
            image.src = photo.src;
            image.alt = photo.alt;
            panel.append(image);
          }
          stage.append(panel);
        }
        return stage;
      }

      async function showStage(nextStage) {
        if (!currentStage || transitionStyle === "none" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          currentStage?.remove();
          nextStage.style.opacity = "1";
          stageHost.append(nextStage);
          currentStage = nextStage;
          return;
        }

        const previous = currentStage;
        if (transitionStyle === "fade-black") {
          previous.style.transition = "opacity " + Math.round(transitionMs / 2) + "ms ease";
          previous.style.opacity = "0";
          await wait(Math.round(transitionMs / 2));
          previous.remove();
          stageHost.append(nextStage);
          nextStage.style.transition = "opacity " + Math.round(transitionMs / 2) + "ms ease";
          requestAnimationFrame(() => { nextStage.style.opacity = "1"; });
          await wait(Math.round(transitionMs / 2));
        } else if (transitionStyle === "slide-left" || transitionStyle === "slide-right") {
          const direction = transitionStyle === "slide-left" ? 1 : -1;
          nextStage.style.transform = "translateX(" + (direction * 100).toString() + "%)";
          stageHost.append(nextStage);
          void nextStage.offsetWidth;
          const transition = "opacity " + transitionMs + "ms ease, transform " + transitionMs + "ms ease";
          previous.style.transition = transition;
          nextStage.style.transition = transition;
          requestAnimationFrame(() => {
            previous.style.opacity = "0";
            previous.style.transform = "translateX(" + (-direction * 35).toString() + "%)";
            nextStage.style.opacity = "1";
            nextStage.style.transform = "translateX(0)";
          });
          await wait(transitionMs);
          previous.remove();
        } else {
          if (transitionStyle === "slow-pan") nextStage.style.transform = "scale(.985)";
          stageHost.append(nextStage);
          void nextStage.offsetWidth;
          const transition = transitionStyle === "slow-pan"
            ? "opacity " + transitionMs + "ms ease, transform " + transitionMs + "ms ease-out"
            : "opacity " + transitionMs + "ms ease";
          previous.style.transition = "opacity " + transitionMs + "ms ease";
          nextStage.style.transition = transition;
          requestAnimationFrame(() => {
            previous.style.opacity = "0";
            nextStage.style.opacity = "1";
            if (transitionStyle === "slow-pan") nextStage.style.transform = "scale(1.02)";
          });
          await wait(transitionMs);
          previous.remove();
        }
        currentStage = nextStage;
      }

      function updateClock() {
        if (!clock) return;
        const date = new Date();
        const timeOptions = { hour:"numeric", minute:"2-digit"${settings.clockShowSeconds ? ', second:"2-digit"' : ""}${settings.clockFormat === "12h" ? ", hour12:true" : settings.clockFormat === "24h" ? ", hour12:false" : ""} };
        const time = new Intl.DateTimeFormat(${JSON.stringify(frame.language)}, { ...timeOptions, timeZone:${JSON.stringify(frame.timeZone)} }).format(date);
        const day = ${settings.clockShowDate ? `new Intl.DateTimeFormat(${JSON.stringify(frame.language)}, { timeZone:${JSON.stringify(frame.timeZone)}, weekday:"short", month:"short", day:"numeric" }).format(date)` : '""'};
        clock.textContent = day ? day + "  " + time : time;
      }

      async function advance() {
        if (advancing) return;
        advancing = true;
        try {
          const response = await fetch("/api/display/next?after=" + encodeURIComponent(currentId) + "&session=" + encodeURIComponent(displaySession), { cache:"no-store" });
          const payload = await response.json();
          if (payload.presentationVersion !== presentationVersion) { location.reload(); return; }
          if (!payload.displayOn) {
            scheduleOff = true;
            clearStages();
            hideDisplay();
            scheduleAdvance(5000);
            return;
          }
          if (!payload.photos || payload.photos.length === 0) {
            displaySurface.hidden = false;
            clearStages();
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
          empty.hidden = true;
          await showStage(createStage(payload.layout, nextPhotos));
          currentId = payload.cursor || nextPhotos[nextPhotos.length - 1].id;
          scheduleAdvance(durationMs);
        } catch {
          scheduleAdvance(1000);
        } finally {
          advancing = false;
        }
      }

      async function pollSchedule() {
        try {
          const response = await fetch("/api/display/next?probe=1", { cache:"no-store" });
          const payload = await response.json();
          if (payload.presentationVersion !== presentationVersion) { location.reload(); return; }
          if (!payload.displayOn) {
            scheduleOff = true;
            clearStages();
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
