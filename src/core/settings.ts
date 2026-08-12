export interface DisplaySettings {
  selectedFolderIds: string[];
  orderMode:
    | "random"
    | "filename-asc"
    | "filename-desc"
    | "upload-newest"
    | "upload-oldest"
    | "capture-newest"
    | "capture-oldest"
    | "manual";
  photoDurationSeconds: number;
  transitionStyle: "none" | "crossfade" | "fade-black" | "slide-left" | "slide-right" | "slow-pan";
  transitionDurationSeconds: number;
  screenOrientation: "landscape" | "portrait";
  screenLayout: "single" | "multiple" | "triple";
  imagePresentationMode: "fit" | "fill" | "fit-blur";
  clockEnabled: boolean;
  clockFormat: "locale-default" | "12h" | "24h";
  clockShowDate: boolean;
  clockSize: "small" | "medium" | "large";
  weatherEnabled: boolean;
  weatherShowCurrent: boolean;
  weatherShowForecast: boolean;
  weatherUnits: "imperial" | "metric";
}

export interface ScheduleSettings {
  enabled: boolean;
  dailyOnTime: string;
  dailyOffTime: string;
  overrideState: "follow-schedule" | "force-on" | "force-off";
}

export function createDefaultFrameSettings(): FrameSettings {
  return {
    frameId: randomUUID(),
    frameName: "piframe",
    frameDescription: "",
    location: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    language: "en-US",
    displayOrientation: 0
  };
}

export function createDefaultDisplaySettings(): DisplaySettings {
  return {
    selectedFolderIds: [],
    orderMode: "random",
    photoDurationSeconds: 15,
    transitionStyle: "crossfade",
    transitionDurationSeconds: 1.5,
    screenOrientation: "landscape",
    screenLayout: "single",
    imagePresentationMode: "fit",
    clockEnabled: false,
    clockFormat: "locale-default",
    clockShowDate: false,
    clockSize: "medium",
    weatherEnabled: false,
    weatherShowCurrent: true,
    weatherShowForecast: false,
    weatherUnits: "imperial"
  };
}

export function createDefaultScheduleSettings(): ScheduleSettings {
  return {
    enabled: false,
    dailyOnTime: "07:00",
    dailyOffTime: "23:00",
    overrideState: "follow-schedule"
  };
}
import { randomUUID } from "node:crypto";

export interface FrameSettings {
  frameId: string;
  frameName: string;
  frameDescription: string;
  location: string;
  weatherLocation?: WeatherLocation;
  timeZone: string;
  language: "en-US";
  displayOrientation: 0 | 90 | 180 | 270;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
}
