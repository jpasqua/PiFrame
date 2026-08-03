interface NominatimResponse {
  address?: Record<string, string | undefined>;
}

export interface ResolvedLocation {
  name: string;
  admin1: string;
  country: string;
}

export class LocationLookupService {
  private readonly cache = new Map<string, ResolvedLocation>();
  private nextRequestAt = 0;

  async reverse(latitude: number, longitude: number): Promise<ResolvedLocation> {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("Enter valid geographic coordinates.");
    }

    // Three decimal places is sufficient for a frame's location and avoids repeated nearby lookups.
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const delay = this.nextRequestAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.nextRequestAt = Date.now() + 1_000;

    const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("lat", latitude.toString());
    endpoint.searchParams.set("lon", longitude.toString());
    endpoint.searchParams.set("zoom", "10");
    endpoint.searchParams.set("addressdetails", "1");
    const response = await fetch(endpoint, {
      headers: {
        "accept": "application/json",
        "user-agent": "PiFrame/0.1 (+https://github.com/jpasqua/PiFrame)"
      },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("Could not look up this location.");

    const result = await response.json() as NominatimResponse;
    const address = result.address ?? {};
    const location: ResolvedLocation = {
      name: address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? "",
      admin1: address.state ?? address.region ?? "",
      country: address.country ?? ""
    };
    if (!location.name && !location.admin1 && !location.country) throw new Error("Could not identify a nearby place.");
    this.cache.set(key, location);
    return location;
  }
}
