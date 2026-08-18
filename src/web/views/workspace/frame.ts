import { normalizeAdministrationTheme, type AdministrationTheme, type FrameSettings } from "../../../core/settings.js";
import { escapeHtml } from "../shared.js";

export function renderFramePanel(active: boolean, settings: FrameSettings): string {
  const timeZones = Intl.supportedValuesOf("timeZone").map((timeZone) => `<option value="${escapeHtml(timeZone)}"></option>`).join("");
  const theme = normalizeAdministrationTheme(settings.theme);
  const themes: Array<{ value: AdministrationTheme; name: string; description: string }> = [
    { value: "neutral", name: "Neutral", description: "Slate and Georgia" },
    { value: "parchment", name: "Parchment", description: "Warm field guide and Inter" },
    { value: "surf", name: "Surf", description: "Pale water, navy, and Inter" },
    { value: "lapis-velvet", name: "Lapis Velvet", description: "Midnight blue, plum, and pearl" },
    { value: "terrazzo", name: "Terrazzo", description: "Earth, ochre, and teal" },
    { value: "pearl", name: "Pearl", description: "Warm neutrals with amethyst" },
    { value: "signal-rain", name: "Signal Rain", description: "Terminal green and IBM Plex Mono" },
    { value: "obsidian-blue", name: "Obsidian Blue", description: "Blue-black with soft periwinkle" }
  ];
  const orientations: Array<{ value: FrameSettings["displayOrientation"]; label: string; arrow: string; shape: "landscape" | "portrait" }> = [
    { value: 0, label: "0 degrees (normal)", arrow: "↑", shape: "landscape" },
    { value: 90, label: "90 degrees (clockwise)", arrow: "→", shape: "portrait" },
    { value: 180, label: "180 degrees", arrow: "↓", shape: "landscape" },
    { value: 270, label: "270 degrees (counter-clockwise)", arrow: "←", shape: "portrait" }
  ];

  return `<section class="panel" data-panel="general"${active ? "" : " hidden"}>
  <div class="card"><form method="post" action="/admin/general/save">
    <section class="section"><h3>Frame Identity</h3><div class="identity-fields">
      ${inlineTextField("frame-name", "Name:", "frameName", settings.frameName, "One lowercase word using letters and numbers.", 'maxlength="63" pattern="[a-z0-9]+" autocapitalize="none" spellcheck="false" required')}
      ${inlineTextField("frame-description", "Description:", "frameDescription", settings.frameDescription, "A one-line description, up to 80 characters.", 'maxlength="80" placeholder="Living Room"')}
    </div></section>
    <section class="section"><h3>Locale</h3>
      <div class="location-field"><div class="location-label">Location ${info("location-search", "Location lookups via Open-Meteo are requested only when you choose to search.")}</div><div class="location-input-row"><input id="frame-location" type="text" name="location" value="${escapeHtml(settings.location)}" maxlength="80" placeholder="City, state, country or postal code"><button id="search-location" class="secondary-action" type="button">Search location</button></div><input id="weather-latitude" type="hidden" name="weatherLatitude" value="${settings.weatherLocation?.latitude ?? ""}"><input id="weather-longitude" type="hidden" name="weatherLongitude" value="${settings.weatherLocation?.longitude ?? ""}"></div>
      <p id="location-lookup-status" class="muted location-status" aria-live="polite"></p><div id="location-search-results" class="location-results" hidden></div>
      <details class="advanced-location"><summary>Fine tune locale settings</summary><div class="advanced-location-fields">
        ${inlineTextField("frame-time-zone", "Time Zone:", "timeZone", settings.timeZone, "Used for scheduling and the clock.", 'list="time-zone-options" required')}
        <datalist id="time-zone-options">${timeZones}</datalist>
        <div class="inline-field identity-field"><label for="frame-language">Language:</label><select id="frame-language" name="language"><option value="en-US"${settings.language === "en-US" ? " selected" : ""}>English (United States)</option></select>${info("language", "More interface languages will be available when PiFrame is translated.")}</div>
      </div></details>
    </section>
    <section class="section"><h3>Physical display</h3><fieldset class="orientation-choices"><legend>Display orientation</legend><div class="orientation-options">${orientations.map(({ value, label, arrow, shape }) => `<label class="orientation-choice" title="${label}"><input type="radio" name="displayOrientation" value="${value}"${settings.displayOrientation === value ? " checked" : ""}><span class="orientation-screen ${shape}" aria-hidden="true">${arrow}</span><span class="sr-only">${label}</span></label>`).join("")}</div></fieldset></section>
    <section class="section"><h3>Administration Theme</h3><fieldset class="theme-choices"><div class="theme-options">${themes.map(({ value, name, description }) => `<label class="theme-choice"><input type="radio" name="theme" value="${value}"${theme === value ? " checked" : ""}><span class="theme-preview" data-theme-preview="${value}" aria-hidden="true"><i></i><b></b><em></em></span><span><strong>${name}</strong><small>${description}</small></span></label>`).join("")}</div><small>Selections preview immediately and are saved with the frame settings.</small></fieldset></section>
    <button class="save" type="submit" disabled>Save changes</button>
  </form><script src="/assets/app/general-location.js" defer></script></div>
</section>`;
}

function info(id: string, text: string): string {
  return `<span class="location-info-wrap"><button class="location-info" type="button" aria-label="About ${id}" aria-describedby="${id}-info">i</button><span id="${id}-info" class="location-tooltip" role="tooltip">${text}</span></span>`;
}

function inlineTextField(id: string, label: string, name: string, value: string, tooltip: string, attributes: string): string {
  return `<div class="inline-field identity-field"><label for="${id}">${label}</label><input id="${id}" type="text" name="${name}" value="${escapeHtml(value)}" ${attributes}>${info(id, tooltip)}</div>`;
}
