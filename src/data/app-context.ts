import {
  createDefaultFrameSettings,
  createDefaultDisplaySettings,
  createDefaultScheduleSettings,
  type FrameSettings,
  type DisplaySettings,
  type ScheduleSettings
} from "../core/settings.js";
import type { AppConfig } from "../config.js";
import { openDatabase } from "./database.js";
import { FolderRepository } from "./folder-repository.js";
import { PhotoRepository } from "./photo-repository.js";
import { SettingsRepository } from "./settings-repository.js";
import { SystemEventRepository } from "./system-event-repository.js";
import { PhotoProcessor } from "../services/photo-processor.js";

export interface AppContext {
  config: AppConfig;
  folders: FolderRepository;
  photos: PhotoRepository;
  settings: SettingsRepository;
  events: SystemEventRepository;
  processor: PhotoProcessor;
}

export function createAppContext(config: AppConfig): AppContext {
  const { db } = openDatabase(config);
  const settings = new SettingsRepository(db);
  const events = new SystemEventRepository(db);

  ensureDefaultSettings(settings);

  const photos = new PhotoRepository(db);
  const processor = new PhotoProcessor(config, photos, events);
  return {
    config,
    folders: new FolderRepository(db),
    photos,
    settings,
    events,
    processor
  };
}

function ensureDefaultSettings(settings: SettingsRepository): void {
  const frameSettings = settings.getJson<StoredFrameSettings>("frame");
  if (!frameSettings) {
    settings.putJson("frame", createDefaultFrameSettings());
  } else if (!frameSettings.language) {
    const { locale: _legacyLocale, ...migratedSettings } = frameSettings;
    settings.putJson("frame", { ...migratedSettings, language: "en-US" });
  }

  const displaySettings = settings.getJson<DisplaySettings>("display");
  if (!displaySettings) {
    settings.putJson("display", createDefaultDisplaySettings());
  }

  const scheduleSettings = settings.getJson<ScheduleSettings>("schedule");
  if (!scheduleSettings) {
    settings.putJson("schedule", createDefaultScheduleSettings());
  }
}

type StoredFrameSettings = Omit<FrameSettings, "language"> & {
  language?: FrameSettings["language"];
  locale?: string;
};
