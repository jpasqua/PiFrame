import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isDisplayOn } from "../core/schedule.js";
import { createDefaultFrameSettings, createDefaultScheduleSettings, type FrameSettings, type ScheduleSettings } from "../core/settings.js";
import type { AppConfig } from "../config.js";
import type { SettingsRepository } from "../data/settings-repository.js";
import type { SystemEventRepository } from "../data/system-event-repository.js";

const execFileAsync = promisify(execFile);
const RECONCILE_INTERVAL_MS = 5_000;

/** Controls the Pi's Wayland HDMI connector without involving the browser. */
export class DisplayPowerController {
  private appliedState: boolean | null = null;
  private lastFailedState: boolean | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly settings: SettingsRepository,
    private readonly events: SystemEventRepository
  ) {}

  start(): void {
    if (this.config.platform !== "raspberry-pi") return;
    void this.reconcile();
    setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS).unref();
  }

  private async reconcile(): Promise<void> {
    const frame = this.settings.getJson<FrameSettings>("frame") ?? createDefaultFrameSettings();
    const schedule = this.settings.getJson<ScheduleSettings>("schedule") ?? createDefaultScheduleSettings();
    const shouldBeOn = isDisplayOn(schedule, new Date(), frame.timeZone);
    if (shouldBeOn === this.appliedState) return;

    try {
      await execFileAsync(this.config.displayPower.command, ["--output", this.config.displayPower.connector, shouldBeOn ? "--on" : "--off"], {
        env: {
          ...process.env,
          WAYLAND_DISPLAY: this.config.displayPower.waylandDisplay,
          XDG_RUNTIME_DIR: this.config.displayPower.runtimeDir
        },
        timeout: 10_000
      });
      this.appliedState = shouldBeOn;
      this.lastFailedState = null;
      this.events.record("info", shouldBeOn ? "display.power_on" : "display.power_off", shouldBeOn ? "Enabled the HDMI display." : "Disabled the HDMI display.", {
        connector: this.config.displayPower.connector
      });
    } catch (error) {
      if (this.lastFailedState === shouldBeOn) return;
      this.lastFailedState = shouldBeOn;
      this.events.record("error", "display.power_failed", "Could not change HDMI display power.", {
        connector: this.config.displayPower.connector,
        requestedState: shouldBeOn ? "on" : "off",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
}
