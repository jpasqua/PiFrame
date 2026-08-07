import type { IncomingMessage, ServerResponse } from "node:http";
import type { WifiPortalService } from "../../services/wifi-portal.js";
import { readForm } from "../http/forms.js";
import { isTrustedOrigin } from "../http/request.js";
import { redirect, sendHtml, sendPlainText } from "../http/responses.js";
import { renderWifiPortalPage } from "../views/wifi-portal.js";

export async function handleWifiPortalRoute(portal: WifiPortalService, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/" && pathname !== "/setup" && pathname !== "/setup/connect") return false;
  const state = await portal.state();
  if (!state || state.mode === "online") {
    if (pathname === "/") return false;
    sendPlainText(res, 404, "Wi-Fi setup is not active.");
    return true;
  }
  if (req.method === "GET" && pathname === "/") { redirect(res, "/setup"); return true; }
  if (req.method === "GET" && pathname === "/setup") { sendHtml(res, 200, renderWifiPortalPage(state)); return true; }
  if (req.method === "POST" && pathname === "/setup/connect") {
    if (!isTrustedOrigin(req)) { sendPlainText(res, 403, "Forbidden"); return true; }
    try {
      const form = await readForm(req);
      await portal.connect(form.ssid?.trim() ?? "", form.password ?? "");
      const nextState = await portal.state() ?? { mode: "connecting" as const, message: "Connecting to Wi-Fi. This may take a moment." };
      sendHtml(res, 200, renderWifiPortalPage(nextState));
    } catch (error) {
      const currentState = await portal.state() ?? state;
      sendHtml(res, 400, renderWifiPortalPage(currentState, error instanceof Error ? error.message : "Could not connect to Wi-Fi."));
    }
    return true;
  }
  sendPlainText(res, 405, "Method not allowed.");
  return true;
}
