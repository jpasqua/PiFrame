import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { AppContext } from "../../data/app-context.js";
import { prefersHtml } from "../http/request.js";
import { sendBinary, sendHtml, sendJson, sendPlainText } from "../http/responses.js";
import { renderHealthPage } from "../views/system.js";

export async function handleSystemRoute(
  context: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/health") {
    if (prefersHtml(req)) {
      sendHtml(res, 200, renderHealthPage(context));
    } else {
      sendJson(res, 200, { ok: true, platform: context.config.platform, dataRoot: context.config.paths.dataRoot });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/assets/images/PiFrame_Words_Right.png") {
    try {
      sendBinary(res, 200, await readFile(resolve(process.cwd(), "assets", "images", "PiFrame_Words_Right.png")), "image/png");
    } catch {
      sendPlainText(res, 404, "Asset not found.");
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/help") {
    try {
      let manual: Buffer;
      try {
        manual = await readFile(resolve(process.cwd(), "src", "web", "static", "help", "index.html"));
      } catch {
        manual = await readFile(resolve(process.cwd(), "dist", "web", "static", "help", "index.html"));
      }
      sendHtml(res, 200, manual.toString("utf8"));
    } catch {
      sendPlainText(res, 404, "Help manual not found.");
    }
    return true;
  }

  const staticMatch = url.pathname.match(/^\/assets\/app\/((?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:js|css))$/);
  if (req.method === "GET" && staticMatch) {
    const filename = staticMatch[1];
    if (!filename) return false;
    try {
      const sourcePath = resolve(process.cwd(), "src", "web", "static", filename);
      const builtPath = resolve(process.cwd(), "dist", "web", "static", filename);
      let asset: Buffer;
      try {
        asset = await readFile(sourcePath);
      } catch {
        asset = await readFile(builtPath);
      }
      sendBinary(res, 200, asset, filename.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    } catch {
      sendPlainText(res, 404, "Asset not found.");
    }
    return true;
  }

  const mediaMatch = url.pathname.match(/^\/media\/(thumbnail|display)\/([0-9a-f-]{36})\.jpg$/);
  if (req.method !== "GET" || !mediaMatch) return false;

  const variant = mediaMatch[1];
  const photo = mediaMatch[2] ? context.photos.get(mediaMatch[2]) : null;
  if (!variant || !photo || photo.processingStatus !== "ready") {
    sendPlainText(res, 404, "Image not found.");
    return true;
  }
  const directory = variant === "thumbnail" ? context.config.paths.thumbnailsDir : context.config.paths.displayDir;
  try {
    sendBinary(res, 200, await readFile(resolve(directory, `${photo.id}.jpg`)), "image/jpeg");
  } catch {
    sendPlainText(res, 404, "Image not found.");
  }
  return true;
}
