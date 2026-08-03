export interface FlashMessage {
  kind: "success" | "error" | null;
  message: string | null;
}

export function readFlash(url: URL): FlashMessage {
  const success = url.searchParams.get("success");
  if (success) return { kind: "success", message: success };
  const error = url.searchParams.get("error");
  if (error) return { kind: "error", message: error };
  return { kind: null, message: null };
}

export function renderFlash(flash: FlashMessage): string {
  if (!flash.message || !flash.kind) return "";
  return `<div class="flash ${flash.kind}" style="transition:opacity .35s ease">${escapeHtml(flash.message)}</div><script>const flash=document.currentScript.previousElementSibling;const flashUrl=new URL(window.location.href);flashUrl.searchParams.delete("success");flashUrl.searchParams.delete("error");history.replaceState(null,"",flashUrl);window.setTimeout(()=>{flash.style.opacity="0";window.setTimeout(()=>flash.remove(),350);},10000);</script>`;
}

export function renderLogo(width: number): string {
  return `<a class="piframe-logo" href="/?about=1" aria-label="About PiFrame" style="display:inline-block;line-height:0"><img src="/assets/images/PiFrame_Words_Right.png" alt="PiFrame" width="${width.toString()}" style="display:block;height:auto"></a>`;
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function formatTimestamp(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(isoTimestamp));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
