import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../data/app-context.js";
import { PhotoIngestionService } from "../services/photo-ingestion.js";
import { LocationLookupService } from "../services/location-lookup.js";
import { SystemActionService } from "../services/system-actions.js";
import { WifiPortalService } from "../services/wifi-portal.js";
import { redirect, sendHtml } from "./http/responses.js";
import { handleDisplayRoute } from "./routes/display.js";
import { RandomDisplayPlanner } from "./display-state.js";
import { handleLibraryActions } from "./routes/library-actions.js";
import { handleLocationRoute } from "./routes/location.js";
import { handleSettingsActions } from "./routes/settings-actions.js";
import { handleSystemRoute } from "./routes/system.js";
import { handleWorkspaceGetRoute } from "./routes/workspace.js";
import { handleWifiPortalRoute } from "./routes/wifi-portal.js";
import { renderNotFoundPage as renderNotFoundView } from "./views/system.js";

interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export function createApp(context: AppContext): App {
  const ingestion = new PhotoIngestionService(context.config, context.photos);
  const locationLookup = new LocationLookupService();
  const randomDisplayPlanner = new RandomDisplayPlanner();
  const systemActions = new SystemActionService(context.config, context.events);
  const wifiPortal = new WifiPortalService(context.config, context.events);

  return {
    async handle(req, res) {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (await handleSystemRoute(context, req, res, url)) return;

      if (await handleWifiPortalRoute(wifiPortal, req, res, url)) return;

      if (await handleDisplayRoute(context, randomDisplayPlanner, wifiPortal, req, res, url)) return;
      if (handleWorkspaceGetRoute(context, req, res, url)) return;

      if (await handleLocationRoute(locationLookup, req, res, url)) return;

      if (await handleSettingsActions(context, systemActions, req, res, url)) return;

      if (method === "GET" && url.pathname === "/admin/schedule") {
        redirect(res, "/?view=schedule");
        return;
      }

      const libraryHandled = await handleLibraryActions(context, ingestion, req, res, url);
      if (libraryHandled || res.writableEnded) return;

      sendHtml(res, 404, renderNotFoundView(url.pathname));
    }
  };
}
