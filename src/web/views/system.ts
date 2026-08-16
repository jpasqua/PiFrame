import type { AppContext } from "../../data/app-context.js";
import { escapeHtml, renderLogo } from "./shared.js";

export function renderSystemActionPage(action: "restart" | "shutdown"): string {
  const restarting = action === "restart";
  const title = restarting ? "Restarting PiFrame" : "Shutting down PiFrame";
  const heading = restarting ? "PiFrame is restarting." : "PiFrame is shutting down.";
  const description = restarting
    ? "The frame and local connection will be unavailable briefly. This page will wait before checking whether PiFrame is ready again."
    : "The frame may take a moment to go dark. Once it is dark, it is safe to remove power. This page will not try to reconnect automatically.";
  const reconnectScript = restarting ? `<script>
    (() => {
      const status = document.querySelector("#reconnect-status");
      const retryDelays = [2000, 4000, 8000, 15000];
      const deadline = Date.now() + 120000;
      let attempt = 0;
      const setStatus = (message) => { if (status) status.textContent = message; };
      const check = () => {
        setStatus("Checking whether PiFrame is back online…");
        fetch("/health", { cache: "no-store" })
          .then((response) => {
            if (!response.ok) throw new Error("Health check failed");
            location.replace("/?view=status");
          })
          .catch(() => {
            if (Date.now() >= deadline) {
              setStatus("PiFrame has not reconnected yet. Wi-Fi may still be reconnecting; use Try again when it is ready.");
              return;
            }
            const delay = retryDelays[Math.min(attempt++, retryDelays.length - 1)];
            setStatus("PiFrame is still restarting. Trying again shortly…");
            setTimeout(check, delay);
          });
      };
      setTimeout(check, 60000);
    })();
  </script>` : "";
  const reconnectControls = restarting
    ? `<p id="reconnect-status" class="status" aria-live="polite">Waiting 60 seconds before checking for PiFrame…</p><p><a href="/?view=status">Try again</a></p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} - PiFrame</title><style>:root{--bg:#f3f4f5;--paper:#fff;--ink:#3f464e;--muted:#737b85;--line:#d7dbe0;--accent:#58636e;--success:#187567}body{margin:0;color:var(--ink);font-family:Georgia,"Times New Roman",serif;background:linear-gradient(180deg,#fafafa 0,var(--bg) 100%)}main{max-width:760px;min-height:100vh;margin:auto;padding:34px 20px}.card{margin-top:38px;padding:26px;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 20px rgba(43,49,58,.05)}h1{margin:0 0 10px;font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.05em}p{color:var(--muted);line-height:1.55}.status{font-weight:700;color:var(--success);margin-top:24px}a{color:var(--accent)}</style></head><body><main>${renderLogo(160)}<section class="card"><h1>${heading}</h1><p>${description}</p>${reconnectControls}</section></main>${reconnectScript}</body></html>`;
}

export function renderHealthPage(context: AppContext): string {
  const stats = context.photos.stats();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Health - PiFrame</title><style>:root{--bg:#f3f4f5;--paper:#fff;--ink:#3f464e;--muted:#737b85;--line:#d7dbe0;--accent:#58636e;--success:#187567}body{margin:0;color:var(--ink);font-family:Georgia,"Times New Roman",serif;background:linear-gradient(180deg,#fafafa 0,var(--bg) 100%)}main{max-width:760px;min-height:100vh;margin:auto;padding:34px 20px}.card{margin-top:38px;padding:26px;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 20px rgba(43,49,58,.05)}h1{margin:0 0 10px;font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.05em}p{color:var(--muted);line-height:1.55}.ok{color:var(--success);font-weight:700}dl{display:grid;grid-template-columns:max-content 1fr;gap:10px 18px;margin:24px 0 0}dt{color:var(--muted)}dd{margin:0;font-weight:700}code{color:var(--accent)}</style></head><body><main>${renderLogo(160)}<section class="card"><p class="ok">System healthy</p><h1>PiFrame is running.</h1><p>The local server and SQLite library are available.</p><dl><dt>Platform</dt><dd><code>${escapeHtml(context.config.platform)}</code></dd><dt>Host</dt><dd><code>${escapeHtml(context.config.host)}:${context.config.port.toString()}</code></dd><dt>Ready photos</dt><dd>${stats.ready.toString()}</dd><dt>Photos needing attention</dt><dd>${(stats.pending + stats.processing + stats.failed).toString()}</dd></dl></section></main></body></html>`;
}

export function renderNotFoundPage(pathname: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title><style>:root{--bg:#f3f4f5;--ink:#3f464e;--muted:#737b85;--accent:#58636e}body{margin:0;color:var(--ink);font-family:Georgia,"Times New Roman",serif;background:linear-gradient(180deg,#fafafa 0,var(--bg) 100%)}main{max-width:700px;min-height:100vh;margin:0 auto;padding:36px 20px}h1{margin-top:46px;font-size:clamp(2rem,5vw,3.5rem);letter-spacing:-.05em}p{color:var(--muted);line-height:1.55}code{color:var(--accent)}</style></head><body><main>${renderLogo(142)}<h1>Not found</h1><p>No route is defined for <code>${escapeHtml(pathname)}</code>.</p></main></body></html>`;
}
