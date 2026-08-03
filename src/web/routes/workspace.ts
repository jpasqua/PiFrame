import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../../data/app-context.js";
import { redirect, sendHtml } from "../http/responses.js";
import { readFlash, type FlashMessage } from "../views/shared.js";

export interface WorkspaceViews {
  settings(context: AppContext, flash: FlashMessage, section: string | null): string;
  album(context: AppContext, folderId: string, flash: FlashMessage): string;
  albums(context: AppContext, flash: FlashMessage): string;
  display(context: AppContext, flash: FlashMessage): string;
  notFound(pathname: string): string;
}

export function handleWorkspaceGetRoute(context: AppContext, req: IncomingMessage, res: ServerResponse, url: URL, views: WorkspaceViews): boolean {
  if (req.method !== "GET") return false;
  if (url.pathname === "/") { sendHtml(res, 200, views.settings(context, readFlash(url), url.searchParams.get("view") ?? url.searchParams.get("section"))); return true; }
  if (url.pathname === "/admin") { redirect(res, "/"); return true; }
  if (url.pathname === "/admin/settings") { const section = url.searchParams.get("section"); redirect(res, section ? `/?view=${encodeURIComponent(section)}` : "/"); return true; }
  const match = url.pathname.match(/^\/admin\/folders\/([^/]+)\/photos$/);
  if (match) { const folder = context.folders.get(decodeURIComponent(match[1] ?? "")); sendHtml(res, folder ? 200 : 404, folder ? views.album(context, folder.id, readFlash(url)) : views.notFound(url.pathname)); return true; }
  if (url.pathname === "/admin/folders") { sendHtml(res, 200, views.albums(context, readFlash(url))); return true; }
  if (url.pathname === "/admin/status") { redirect(res, "/?view=status"); return true; }
  if (url.pathname === "/admin/display") { sendHtml(res, 200, views.display(context, readFlash(url))); return true; }
  return false;
}
