const locationInput = document.querySelector("#frame-location");
const timeZoneInput = document.querySelector("#frame-time-zone");
const weatherLatitudeInput = document.querySelector("#weather-latitude");
const weatherLongitudeInput = document.querySelector("#weather-longitude");
const searchButton = document.querySelector("#search-location");
const status = document.querySelector("#location-lookup-status");
const results = document.querySelector("#location-search-results");
const postalCodeLocationOverrides = new Map([
  ["93921", "Carmel, CA"],
  ["93923", "Carmel, CA"]
]);

if (locationInput && timeZoneInput && weatherLatitudeInput && weatherLongitudeInput && searchButton && status && results) {

  function setStatus(message) {
    status.textContent = message;
  }

  function clearResults() {
    results.replaceChildren();
    results.hidden = true;
  }

  function applyLocation(result) {
    const label = [result.name, result.admin1, result.country].filter(Boolean).join(", ");
    locationInput.value = label || result.name || locationInput.value;
    if (result.timezone) timeZoneInput.value = result.timezone;
    weatherLatitudeInput.value = Number.isFinite(result.latitude) ? String(result.latitude) : "";
    weatherLongitudeInput.value = Number.isFinite(result.longitude) ? String(result.longitude) : "";
    clearResults();
    setStatus(`Using ${locationInput.value}. Confirm the advanced values if needed, then save General settings.`);
  }

  async function searchOpenMeteo(query, language) {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=${encodeURIComponent(language)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Location search failed");
    const payload = await response.json();
    return Array.isArray(payload.results) ? payload.results : [];
  }

  function trailingPostalCode(value) {
    const match = value.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?$/);
    return match?.[1] ?? null;
  }

  function withoutTrailingPostalCode(value) {
    return value.replace(/(?:,?\s+)\d{5}(?:-\d{4})?$/, "").trim();
  }

  async function searchLocation() {
    const enteredLocation = locationInput.value.trim();
    if (enteredLocation.length < 2) {
      setStatus("Enter at least two characters to search for a location.");
      return;
    }

    searchButton.disabled = true;
    clearResults();
    setStatus("Searching for locations...");
    try {
      const language = (navigator.language || "en").split("-")[0];
      const postalCode = trailingPostalCode(enteredLocation);
      let matches = await searchOpenMeteo(enteredLocation, language);

      if (matches.length === 0 && postalCode) {
        const locationWithoutPostalCode = withoutTrailingPostalCode(enteredLocation);
        if (locationWithoutPostalCode && locationWithoutPostalCode !== enteredLocation) {
          matches = await searchOpenMeteo(locationWithoutPostalCode, language);
        }
      }

      if (matches.length === 0 && postalCode) {
        const overrideLocation = postalCodeLocationOverrides.get(postalCode);
        if (overrideLocation) matches = await searchOpenMeteo(overrideLocation, language);
      }

      if (matches.length === 0) {
        setStatus("No matching locations found. Try adding a region or country.");
        return;
      }
      matches.forEach((match) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "location-result";
        const label = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
        const place = document.createElement("span");
        place.textContent = label;
        const zone = document.createElement("small");
        zone.textContent = match.timezone || "";
        button.append(place, zone);
        button.addEventListener("click", () => applyLocation(match));
        results.append(button);
      });
      results.hidden = false;
      setStatus("Choose the location that best matches your frame.");
    } catch {
      setStatus("Location search is unavailable. You can enter the location and advanced values manually.");
    } finally {
      searchButton.disabled = false;
    }
  }

  searchButton.addEventListener("click", searchLocation);
  locationInput.addEventListener("input", () => {
    weatherLatitudeInput.value = "";
    weatherLongitudeInput.value = "";
  });
}
