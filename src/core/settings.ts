export interface DisplaySettings {
  selectedFolderIds: string[];
  orderMode:
    | "random"
    | "filename-asc"
    | "filename-desc"
    | "upload-newest"
    | "upload-oldest"
    | "capture-newest"
    | "capture-oldest";
  photoDurationSeconds: number;
  transitionStyle: "none" | "crossfade" | "fade-black" | "slide-left" | "slide-right" | "slow-pan";
  transitionDurationSeconds: number;
  screenOrientation: "landscape" | "portrait";
  screenLayout: "single" | "triple";
  imagePresentationMode: "fit" | "fill" | "fit-blur";
  clockEnabled: boolean;
  clockFormat: "locale-default" | "12h" | "24h";
  clockShowSeconds: boolean;
  clockShowDate: boolean;
  clockSize: "small" | "medium" | "large";
}

export interface ScheduleSettings {
  enabled: boolean;
  dailyOnTime: string;
  dailyOffTime: string;
  overrideState: "follow-schedule" | "force-on" | "force-off";
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
    clockShowSeconds: false,
    clockShowDate: false,
    clockSize: "medium"
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
