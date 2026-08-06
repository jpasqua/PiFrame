const locationInput = document.querySelector("#frame-location");
const timeZoneInput = document.querySelector("#frame-time-zone");
const searchButton = document.querySelector("#search-location");
const status = document.querySelector("#location-lookup-status");
const results = document.querySelector("#location-search-results");

if (locationInput && timeZoneInput && searchButton && status && results) {

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
    clearResults();
    setStatus(`Using ${locationInput.value}. Confirm the advanced values if needed, then save General settings.`);
  }

  async function searchLocation() {
    const query = locationInput.value.trim();
    if (query.length < 2) {
      setStatus("Enter at least two characters to search for a location.");
      return;
    }

    searchButton.disabled = true;
    clearResults();
    setStatus("Searching for locations...");
    try {
      const language = (navigator.language || "en").split("-")[0];
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=${encodeURIComponent(language)}`, { cache: "no-store" });
      const payload = await response.json();
      const matches = Array.isArray(payload.results) ? payload.results : [];
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
}
