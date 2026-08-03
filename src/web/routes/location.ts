import type { IncomingMessage, ServerResponse } from "node:http";
import { LocationLookupService } from "../../services/location-lookup.js";
import { readForm } from "../http/forms.js";
import { isTrustedOrigin } from "../http/request.js";
import { sendJson, sendPlainText } from "../http/responses.js";

export async function handleLocationRoute(lookup: LocationLookupService, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/api/location/reverse") return false;
  if (!isTrustedOrigin(req)) {
    sendPlainText(res, 403, "Forbidden");
    return true;
  }

  try {
    const form = await readForm(req);
    const location = await lookup.reverse(Number(form.latitude), Number(form.longitude));
    sendJson(res, 200, location);
  } catch (error) {
    sendJson(res, 400, { status: "error", message: error instanceof Error ? error.message : "Could not look up this location." });
  }
  return true;
}
