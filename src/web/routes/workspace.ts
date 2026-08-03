import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../../data/app-context.js";
import { redirect, sendHtml } from "../http/responses.js";
import { readFlash, type FlashMessage } from "../views/shared.js";
import { renderFolderPhotosPage, renderSettingsPage } from "../views/workspace.js";
import { renderNotFoundPage } from "../views/system.js";

export function handleWorkspaceGetRoute(context: AppContext, req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (req.method !== "GET") return false;
  if (url.pathname === "/") { sendHtml(res, 200, renderSettingsPage(context, readFlash(url), url.searchParams.get("view") ?? url.searchParams.get("section"))); return true; }
  if (url.pathname === "/admin") { redirect(res, "/"); return true; }
  if (url.pathname === "/admin/settings") { const section = url.searchParams.get("section"); redirect(res, section === "display" ? "/?view=presentation" : section ? `/?view=${encodeURIComponent(section)}` : "/"); return true; }
  const match = url.pathname.match(/^\/admin\/folders\/([^/]+)\/photos$/);
  if (match) { const folder = context.folders.get(decodeURIComponent(match[1] ?? "")); sendHtml(res, folder ? 200 : 404, folder ? renderFolderPhotosPage(context, folder.id, readFlash(url)) : renderNotFoundPage(url.pathname)); return true; }
  if (url.pathname === "/admin/folders") { redirect(res, "/?view=folders"); return true; }
  if (url.pathname === "/admin/status") { redirect(res, "/?view=status"); return true; }
  if (url.pathname === "/admin/display" || url.pathname === "/admin/presentation") { redirect(res, "/?view=presentation"); return true; }
  return false;
}
