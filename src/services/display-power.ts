import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
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
  private appliedOrientation: FrameSettings["displayOrientation"] | null = null;
  private lastFailedOrientation: FrameSettings["displayOrientation"] | null = null;
  private resolvedConnector: string | null = null;

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
    if (shouldBeOn !== this.appliedState && !await this.setPower(shouldBeOn)) return;
    if (!shouldBeOn || frame.displayOrientation === this.appliedOrientation) return;
    await this.setOrientation(frame.displayOrientation);
  }

  private async setPower(shouldBeOn: boolean): Promise<boolean> {
    let lastError: unknown = new Error("No usable Wayland display found");
    const attemptedConnectors = new Set<string>();
    for (const waylandDisplay of this.waylandDisplays()) {
      const connectors = await this.connectorsForDisplay(waylandDisplay);
      for (const connector of connectors) {
        attemptedConnectors.add(connector);
        try {
          await this.runWlrRandr(waylandDisplay, ["--output", connector, shouldBeOn ? "--on" : "--off"]);
          this.resolvedConnector = connector;
          this.appliedState = shouldBeOn;
          this.lastFailedState = null;
          this.events.record("info", shouldBeOn ? "display.power_on" : "display.power_off", shouldBeOn ? "Enabled the HDMI display." : "Disabled the HDMI display.", {
            connector,
            waylandDisplay
          });
          return true;
        } catch (error) {
          lastError = error;
        }
      }
    }

    if (this.lastFailedState === shouldBeOn) return false;
    this.lastFailedState = shouldBeOn;
    this.events.record("error", "display.power_failed", "Could not change HDMI display power.", {
      requestedState: shouldBeOn ? "on" : "off",
      waylandDisplays: this.waylandDisplays(),
      attemptedConnectors: [...attemptedConnectors],
      error: lastError instanceof Error ? lastError.message : "Unknown error"
    });
    return false;
  }

  private async setOrientation(orientation: FrameSettings["displayOrientation"]): Promise<boolean> {
    let lastError: unknown = new Error("No usable Wayland display found");
    const attemptedConnectors = new Set<string>();
    for (const waylandDisplay of this.waylandDisplays()) {
      const connectors = await this.connectorsForDisplay(waylandDisplay);
      for (const connector of connectors) {
        attemptedConnectors.add(connector);
        try {
          await this.runWlrRandr(waylandDisplay, ["--output", connector, "--transform", orientation === 0 ? "normal" : orientation.toString()]);
          this.resolvedConnector = connector;
          this.appliedOrientation = orientation;
          this.lastFailedOrientation = null;
          this.events.record("info", "display.orientation_set", "Applied the HDMI display orientation.", {
            connector,
            waylandDisplay,
            orientation
          });
          return true;
        } catch (error) {
          lastError = error;
        }
      }
    }

    if (this.lastFailedOrientation === orientation) return false;
    this.lastFailedOrientation = orientation;
    this.events.record("error", "display.orientation_failed", "Could not change HDMI display orientation.", {
      requestedOrientation: orientation,
      waylandDisplays: this.waylandDisplays(),
      attemptedConnectors: [...attemptedConnectors],
      error: lastError instanceof Error ? lastError.message : "Unknown error"
    });
    return false;
  }

  private async connectorsForDisplay(waylandDisplay: string): Promise<string[]> {
    const automatic = await this.detectConnector(waylandDisplay);
    const candidates = [this.config.displayPower.connector, this.resolvedConnector, automatic]
      .filter((connector): connector is string => typeof connector === "string" && connector.length > 0);
    return [...new Set(candidates)];
  }

  private async detectConnector(waylandDisplay: string): Promise<string | null> {
    try {
      const { stdout } = await this.runWlrRandr(waylandDisplay, ["--json"]);
      const outputs = parseOutputs(stdout).filter((output) => /^HDMI-A-\d+$/.test(output.name));
      const enabled = outputs.filter((output) => output.enabled);
      if (enabled.length === 1) return enabled[0]!.name;
      if (outputs.length === 1) return outputs[0]!.name;
      return null;
    } catch {
      return null;
    }
  }

  private runWlrRandr(waylandDisplay: string, args: string[]) {
    return execFileAsync(this.config.displayPower.command, args, {
      env: {
        ...process.env,
        WAYLAND_DISPLAY: waylandDisplay,
        XDG_RUNTIME_DIR: this.config.displayPower.runtimeDir
      },
      timeout: 10_000
    });
  }

  private waylandDisplays(): string[] {
    const detected = this.detectWaylandDisplays();
    return [...new Set([this.config.displayPower.waylandDisplay, ...detected].filter(Boolean))];
  }

  private detectWaylandDisplays(): string[] {
    try {
      return readdirSync(this.config.displayPower.runtimeDir, { withFileTypes: true })
        .filter((entry) => entry.isSocket() && /^wayland-\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }
}

function parseOutputs(raw: string): Array<{ name: string; enabled: boolean }> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((output) => {
      if (!output || typeof output !== "object") return [];
      const record = output as { name?: unknown; enabled?: unknown };
      return typeof record.name === "string" ? [{ name: record.name, enabled: record.enabled === true }] : [];
    });
  } catch {
    return [];
  }
}
