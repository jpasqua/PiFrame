import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../data/app-context.js";
import { PhotoIngestionService } from "../services/photo-ingestion.js";
import { sendHtml } from "./http/responses.js";
import { handleDisplayRoute } from "./routes/display.js";
import { handleLibraryActions } from "./routes/library-actions.js";
import { handleSettingsActions } from "./routes/settings-actions.js";
import { handleSystemRoute } from "./routes/system.js";
import { handleWorkspaceGetRoute } from "./routes/workspace.js";
import { readFlash } from "./views/shared.js";
import { renderNotFoundPage as renderNotFoundView } from "./views/system.js";
import { renderScheduleSettingsPage } from "./views/workspace.js";

interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export function createApp(context: AppContext): App {
  const ingestion = new PhotoIngestionService(context.config, context.photos);

  return {
    async handle(req, res) {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (await handleSystemRoute(context, req, res, url)) return;

      if (handleDisplayRoute(context, req, res, url)) return;
      if (handleWorkspaceGetRoute(context, req, res, url)) return;

      if (await handleSettingsActions(context, req, res, url)) return;

      if (method === "GET" && url.pathname === "/admin/schedule") {
        return sendHtml(res, 200, renderScheduleSettingsPage(context, readFlash(url)));
      }

      const libraryHandled = await handleLibraryActions(context, ingestion, req, res, url);
      if (libraryHandled || res.writableEnded) return;

      sendHtml(res, 404, renderNotFoundView(url.pathname));
    }
  };
}
