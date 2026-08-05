import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createAppContext } from "./data/app-context.js";
import { DisplayPowerController } from "./services/display-power.js";
import { cleanupStaleStagedUploads } from "./services/photo-ingestion.js";
import { createApp } from "./web/app.js";

const config = loadConfig();
const context = createAppContext(config);
const app = createApp(context);

context.processor.processPending();
new DisplayPowerController(config, context.settings, context.events).start();

async function cleanStagedUploads(): Promise<void> {
  try {
    const removed = await cleanupStaleStagedUploads(config);
    if (removed > 0) {
      context.events.record("info", "uploads.stale_cleaned", "Removed stale staged uploads.", { removed });
    }
  } catch (error) {
    context.events.record("error", "uploads.cleanup_failed", "Could not clean staged uploads.", {
      error: error instanceof Error ? error.message : "Unknown cleanup error"
    });
  }
}

void cleanStagedUploads();
setInterval(() => void cleanStagedUploads(), 6 * 60 * 60 * 1000).unref();

const server = createServer(app.handle);

server.listen(config.port, config.host, () => {
  console.log(
    `PiFrame listening on http://${config.host}:${config.port} using ${config.platform} platform mode`
  );
});
