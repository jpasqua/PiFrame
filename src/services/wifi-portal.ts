import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config.js";
import type { SystemEventRepository } from "../data/system-event-repository.js";

export interface WifiPortalState {
  mode: "connecting" | "setup" | "online";
  ssid?: string;
  address?: string;
  message?: string;
}

export class WifiPortalService {
  constructor(
    private readonly config: AppConfig,
    private readonly events: SystemEventRepository
  ) {}

  async state(): Promise<WifiPortalState | null> {
    if (this.config.platform !== "raspberry-pi") return null;
    try {
      const raw = await readFile(this.config.networkPortal.stateFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isPortalState(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async connect(ssid: string, password: string): Promise<void> {
    if (this.config.platform !== "raspberry-pi") throw new Error("Wi-Fi setup is available only on a Raspberry Pi.");
    if (!ssid || ssid.length > 128 || /[\r\n]/.test(ssid)) throw new Error("Enter a valid Wi-Fi network name.");
    if (password.length > 128 || /[\r\n]/.test(password)) throw new Error("Enter a valid Wi-Fi password.");

    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn("/usr/bin/sudo", ["-n", this.config.networkPortal.command, "connect"], {
        stdio: ["pipe", "ignore", "pipe"]
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(stderr.trim() || "Could not connect to that Wi-Fi network."));
      });
      child.stdin.end(`${ssid}\n${password}\n`);
    });
    this.events.record("info", "wifi.connection_requested", "A Wi-Fi connection was requested through the setup portal.", { ssid });
  }
}

function isPortalState(value: unknown): value is WifiPortalState {
  if (!value || typeof value !== "object") return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === "connecting" || mode === "setup" || mode === "online";
}
