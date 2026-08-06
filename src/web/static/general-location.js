const locationInput = document.querySelector("#frame-location");
const timeZoneInput = document.querySelector("#frame-time-zone");
const locateButton = document.querySelector("#locate-frame");
const searchButton = document.querySelector("#search-location");
const status = document.querySelector("#location-lookup-status");
const results = document.querySelector("#location-search-results");

if (locationInput && timeZoneInput && locateButton && searchButton && status && results) {

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

  function locateFrame() {
    if (!window.isSecureContext) {
      setStatus("This browser requires a secure context for location. Open PiFrame at http://127.0.0.1 or http://localhost.");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("This browser cannot provide location. Search or enter it manually instead.");
      return;
    }
    locateButton.disabled = true;
    clearResults();
    setStatus("Requesting this browser's location...");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      locationInput.value = `Current location (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
      const reverseLookup = fetch("/api/location/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) })
      }).then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Reverse lookup failed")));
      const timeZoneLookup = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m&timezone=auto`, { cache: "no-store" }).then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Time zone lookup failed")));
      const [place, timeZone] = await Promise.allSettled([reverseLookup, timeZoneLookup]);
      if (place.status === "fulfilled") applyLocation(place.value);
      if (timeZone.status === "fulfilled" && timeZone.value.timezone) timeZoneInput.value = timeZone.value.timezone;
      locateButton.disabled = false;
      if (place.status === "fulfilled") {
        setStatus(`Using ${locationInput.value}. Confirm the advanced time zone if needed, then save General settings.`);
      } else {
        setStatus("Used this device's coordinates. Confirm the advanced time zone before saving.");
      }
    }, (error) => {
      locateButton.disabled = false;
      if (error.code === error.PERMISSION_DENIED) {
        setStatus("Browser location permission was denied. Enable Location Services for this browser in macOS Privacy & Security, then allow this site and try again.");
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        setStatus("This browser could not determine a location. Check the network connection or search for the location manually.");
      } else if (error.code === error.TIMEOUT) {
        setStatus("Location lookup timed out. Try again or search for the location manually.");
      } else {
        setStatus("This browser could not determine a location. Search or enter it manually instead.");
      }
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  }

  searchButton.addEventListener("click", searchLocation);
  locateButton.addEventListener("click", locateFrame);
}
