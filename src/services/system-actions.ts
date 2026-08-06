import { spawn } from "node:child_process";
import type { AppConfig } from "../config.js";
import type { SystemEventRepository } from "../data/system-event-repository.js";

export type SystemAction = "restart" | "shutdown";

/** Requests a privileged, narrowly scoped power action through the installed Pi helper. */
export class SystemActionService {
  constructor(
    private readonly config: AppConfig,
    private readonly events: SystemEventRepository
  ) {}

  request(action: SystemAction): boolean {
    if (this.config.platform !== "raspberry-pi") return false;

    this.events.record("info", `system.${action}_requested`, action === "restart" ? "Pi restart requested." : "Pi shutdown requested.", {});
    // Let the HTTP response containing the transition page reach the browser before
    // systemd stops the server and network services.
    const timer = setTimeout(() => this.execute(action), 750);
    timer.unref();
    return true;
  }

  private execute(action: SystemAction): void {
    const child = spawn("/usr/bin/sudo", ["-n", "/usr/local/sbin/piframe-system-action", action], {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", (error) => {
      this.events.record("error", `system.${action}_failed`, action === "restart" ? "Could not restart the Pi." : "Could not shut down the Pi.", {
        error: error.message
      });
    });
    child.once("exit", (code, signal) => {
      if (code === 0) return;
      this.events.record("error", `system.${action}_failed`, action === "restart" ? "Could not restart the Pi." : "Could not shut down the Pi.", {
        exitCode: code,
        signal
      });
    });
    child.unref();
  }
}
