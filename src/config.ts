import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  platform: "desktop" | "raspberry-pi";
  paths: AppPaths;
}

export interface AppPaths {
  dataRoot: string;
  databaseFile: string;
  configDir: string;
  originalsDir: string;
  derivedDir: string;
  thumbnailsDir: string;
  displayDir: string;
  blurredDir: string;
  logsDir: string;
  tempDir: string;
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dataRoot = resolve(process.env.PIFRAME_DATA_ROOT ?? `${cwd}/data`);
  const paths = createPaths(dataRoot);
  ensureDirectories(paths);

  return {
    host: process.env.PIFRAME_HOST ?? "127.0.0.1",
    port: parsePort(process.env.PIFRAME_PORT, 3040),
    platform: parsePlatform(process.env.PIFRAME_PLATFORM),
    paths
  };
}

function createPaths(dataRoot: string): AppPaths {
  const derivedDir = resolve(dataRoot, "derived");

  return {
    dataRoot,
    databaseFile: resolve(dataRoot, "app.db"),
    configDir: resolve(dataRoot, "config"),
    originalsDir: resolve(dataRoot, "originals"),
    derivedDir,
    thumbnailsDir: resolve(derivedDir, "thumbnails"),
    displayDir: resolve(derivedDir, "display"),
    blurredDir: resolve(derivedDir, "blurred"),
    logsDir: resolve(dataRoot, "logs"),
    tempDir: resolve(dataRoot, "tmp")
  };
}

function ensureDirectories(paths: AppPaths): void {
  const directories = [
    paths.dataRoot,
    paths.configDir,
    paths.originalsDir,
    paths.derivedDir,
    paths.thumbnailsDir,
    paths.displayDir,
    paths.blurredDir,
    paths.logsDir,
    paths.tempDir
  ];

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function parsePlatform(raw: string | undefined): AppConfig["platform"] {
  return raw === "raspberry-pi" ? "raspberry-pi" : "desktop";
}
