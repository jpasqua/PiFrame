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
      #display-surface { position:relative; display:grid; place-items:center; overflow:hidden; background:#000; }
      #display-surface[hidden] { display:none; }
      main.orientation-0 #display-surface, main.orientation-180 #display-surface { width:min(100vw,calc(100vh * 16 / 9)); height:min(100vh,calc(100vw * 9 / 16)); }
      main.orientation-90 #display-surface, main.orientation-270 #display-surface { width:min(100vw,calc(100vh * 9 / 16)); height:min(100vh,calc(100vw * 16 / 9)); }
      #stage-host { position:absolute; inset:0; overflow:hidden; background:#000; }
      .stage { position:absolute; inset:0; display:grid; grid-template-columns:1fr; gap:0; background:#000; will-change:opacity,transform; }
      .stage.portrait-pair { grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.landscape-pair { grid-template-rows:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.landscape-side-pair { grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.portrait-triptych { grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }
      .stage.portrait-landscape-trio { grid-template-columns:.37fr .63fr; grid-template-rows:repeat(2,minmax(0,1fr)); gap:4px; }
      .stage.portrait-landscape-trio .photo-panel:first-child { grid-row:1 / -1; }
      .stage.landscape-trio { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:.78fr 1.22fr; gap:4px; }
      .stage.landscape-trio .photo-panel:first-child { grid-column:1 / -1; }
      .stage.portrait-trio { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:1.18fr .82fr; gap:4px; }
      .stage.portrait-trio .photo-panel:last-child { grid-column:1 / -1; }
      .photo-panel { position:relative; min-width:0; min-height:0; margin:0; overflow:hidden; background:#000; }
      .photo-panel::before { content:""; position:absolute; inset:-7%; background:var(--photo-background) center / cover no-repeat; filter:blur(28px); transform:scale(1.08); opacity:.72; }
      img { position:relative; z-index:1; display:block; width:100%; height:100%; min-width:0; object-fit:${presentation}; background:transparent; }
      #empty { position:relative; z-index:1; max-width:32rem; padding:2rem; text-align:center; color:#bdb6aa; line-height:1.6; }
      #clock { position:absolute; z-index:10; left:22px; top:18px; margin:0; color:rgba(255,255,255,.92); font-size:${clockSize}; font-variant-numeric:tabular-nums; letter-spacing:.03em; text-shadow:0 2px 5px #000; }
      #weather { position:absolute; z-index:10; right:22px; bottom:18px; margin:0; color:rgba(255,255,255,.95); font:600 1.1rem/1.25 Arial,sans-serif; font-variant-numeric:tabular-nums; text-align:right; text-shadow:0 2px 5px #000; }
      .weather-current { display:flex; align-items:center; justify-content:flex-end; gap:.5rem; white-space:nowrap; }
      .weather-forecast { display:grid; gap:.2rem; }
      .weather-day { display:grid; grid-template-columns:3rem 5.4rem 1.45rem; align-items:center; justify-content:end; gap:.45rem; white-space:nowrap; }
      .weather-icon { width:1.35rem; height:1.35rem; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; filter:drop-shadow(0 2px 3px #000); }
      .weather-icon .fill { fill:currentColor; stroke:none; }
      @media (prefers-reduced-motion:reduce) { .stage { transition:none !important; } }
    </style>
  </head>
  <body>
    <main class="orientation-${frame.displayOrientation.toString()}">
      <section id="display-surface">
        <section id="stage-host"></section>
        <p id="empty">Waiting for a ready photo. Upload images from the local administration page.</p>
        ${settings.clockEnabled ? `<time id="clock"></time>` : ""}
        ${settings.weatherEnabled ? `<section id="weather" aria-live="polite" hidden></section>` : ""}
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
      const weather = document.querySelector("#weather");
      const weatherShowCurrent = ${settings.weatherShowCurrent ? "true" : "false"};
      const weatherShowForecast = ${settings.weatherShowForecast ? "true" : "false"};
      const weatherUnits = ${JSON.stringify(settings.weatherUnits)};
      let currentStage = null;
      let currentId = "";
      let scheduleOff = false;
      let advanceTimer = null;
      let advancing = false;
      let weatherData = null;
      let weatherRequest = null;
      let weatherSlide = -1;

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

      function weatherIcon(code) {
        if (code === 0) return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
        if (code <= 3) return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3"/><path d="M9 2v2M3 9h2M4.8 4.8l1.4 1.4M14.5 14.5H19a3 3 0 0 0 0-6 4.5 4.5 0 0 0-8.5 2.1A3.2 3.2 0 0 0 11.5 17h7"/></svg>';
        if (code === 45 || code === 48) return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M2 12h14M5 16h16"/></svg>';
        if (code >= 95) return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 16h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 9.5 3.5 3.5 0 0 0 7 16Z M12 16l-2 4h3l-1 3 3-5h-3l1-2"/></svg>';
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14h12a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 7.5 3.5 3.5 0 0 0 6 14Z M8 18h.01M12 20h.01M16 18h.01"/></svg>';
        if (code >= 51) return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 13h12a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 6.5 3.5 3.5 0 0 0 6 13Z M8 17l-1 2M12 17l-1 2M16 17l-1 2"/></svg>';
        return '<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16h14a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 9.5 3.5 3.5 0 0 0 5 16Z"/></svg>';
      }

      function windDirection(degrees) {
        const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        return directions[Math.round(degrees / 22.5) % directions.length];
      }

      function formatTemperature(value) { return Math.round(value).toString() + "°"; }
      function renderWeather() {
        if (!weather || !weatherData) return;
        const showCurrent = weatherShowCurrent && (!weatherShowForecast || weatherSlide % 2 === 0);
        if (showCurrent) {
          const current = weatherData.current;
          const speed = Math.round(current.windSpeed).toString() + (weatherUnits === "imperial" ? " mph" : " km/h");
          weather.innerHTML = '<div class="weather-current"><span>' + formatTemperature(current.temperature) + '</span>' + weatherIcon(current.weatherCode) + '<span>' + speed + ' ' + windDirection(current.windDirection) + '</span></div>';
        } else {
          weather.innerHTML = '<div class="weather-forecast">' + weatherData.forecast.map((day, index) => {
            const label = index === 0 ? "Today" : new Intl.DateTimeFormat(${JSON.stringify(frame.language)}, { timeZone:${JSON.stringify(frame.timeZone)}, weekday:"short" }).format(new Date(day.date + "T12:00:00"));
            return '<div class="weather-day"><span>' + label + '</span><span>' + formatTemperature(day.temperatureHigh) + '/' + formatTemperature(day.temperatureLow) + '</span>' + weatherIcon(day.weatherCode) + '</div>';
          }).join("") + '</div>';
        }
        weather.hidden = false;
      }

      function updateWeatherForSlide() {
        if (!weather || (!weatherShowCurrent && !weatherShowForecast)) return;
        weatherSlide += 1;
        renderWeather();
        if (weatherRequest) return;
        weatherRequest = fetch("/api/display/weather", { cache:"no-store" })
          .then((response) => response.ok ? response.json() : null)
          .then((payload) => { weatherData = payload?.available ? payload : null; if (weatherData) renderWeather(); else weather.hidden = true; })
          .catch(() => { if (!weatherData) weather.hidden = true; })
          .finally(() => { weatherRequest = null; });
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
          updateWeatherForSlide();
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
