import type { AdministrationTheme, DisplaySettings } from "../../../core/settings.js";
import { escapeHtml, renderFlash, renderLogo, type FlashMessage } from "../shared.js";

export type WorkspaceSection = "dashboard" | "general" | "presentation" | "schedule" | "folders" | "status" | "help";

interface WorkspaceShellOptions {
  activeSection: WorkspaceSection;
  display: DisplaySettings;
  flash: FlashMessage;
  helpContents: string;
  panels: string;
  sectionLabel: (section: WorkspaceSection) => string;
  theme: AdministrationTheme;
}

export function renderAdministrationThemeMetadata(theme: AdministrationTheme): string {
  const colors: Record<AdministrationTheme, string> = {
    neutral: "#fafafa",
    parchment: "#fbf8f0",
    surf: "#eef9f7",
    "lapis-velvet": "#ebe8ed",
    terrazzo: "#f6f0e7",
    pearl: "#f5f1ed"
  };
  return `<meta name="theme-color" content="${colors[theme]}">`;
}

export function renderWorkspaceShell({ activeSection, display, flash, helpContents, panels, sectionLabel, theme }: WorkspaceShellOptions): string {
  const sections: WorkspaceSection[] = ["dashboard", "general", "presentation", "schedule", "folders", "status", "help"];
  const navigation = sections.map((section) => `<button type="button" data-section="${section}"${section === activeSection ? ' class="active"' : ""}>${sectionLabel(section)}</button>`).join("");

  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${renderAdministrationThemeMetadata(theme)}<title>Settings - PiFrame</title>
    <link rel="stylesheet" href="/assets/app/workspace.css">
    <link rel="stylesheet" href="/assets/app/dashboard.css">
    <link rel="stylesheet" href="/assets/app/general-location.css">
    <link rel="stylesheet" href="/assets/app/clock-settings.css">
    <link rel="stylesheet" href="/assets/app/themes.css">
    <link rel="stylesheet" href="/assets/app/brand-colors.css">
    <link rel="stylesheet" href="/assets/app/help/manual.css">
    <style>html, body { margin: 0; padding: 0; } .content { padding-top: 0; }</style>
    <meta name="presentation-folder-order" content="${escapeHtml(JSON.stringify(display.selectedFolderIds))}">
    <meta name="presentation-order-mode" content="${escapeHtml(display.orderMode)}">
    <meta name="presentation-transition-style" content="${escapeHtml(display.transitionStyle)}">
    <meta name="presentation-transition-duration" content="${display.transitionDurationSeconds}">
  </head>
  <body><main>
    <aside><div class="brand">${renderLogo(156)}</div><nav>${navigation}</nav>${helpContents}<div id="open-frame-link" class="rail-footer"${activeSection === "general" ? " hidden" : ""}><a href="/display">Open frame</a></div></aside>
    <section class="content"><header class="top"><div><h2 id="section-title">${sectionLabel(activeSection)}</h2></div></header>${renderFlash(flash)}${panels}</section>
    ${renderAboutDialog()}
    <script src="/assets/app/workspace-navigation.js" defer></script>
    <script src="/assets/app/workspace-forms.js" defer></script>
    <script src="/assets/app/workspace-presentation.js" defer></script>
  </main></body>
</html>`;
}

function renderAboutDialog(): string {
  return `<dialog id="about-dialog"><section class="about">${renderLogo(180)}<h3 style="margin-top:22px">About PiFrame</h3><p>PiFrame is a local-first digital picture frame for Raspberry Pi and desktop development. It stores albums and photos locally, prepares display-ready assets, and runs without a cloud service.</p><p><strong>Version 0.1.0</strong><br>Node.js, TypeScript, SQLite, and Chromium kiosk mode.</p><p class="attribution">Location search uses Open-Meteo. Reverse geocoding data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, via Nominatim.</p><button id="about-close" type="button">Close</button></section></dialog>`;
}
