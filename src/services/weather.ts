export interface WeatherLocation {
  latitude: number;
  longitude: number;
  timeZone: string;
}

export interface WeatherUpdateFrequency {
  /** How long current conditions may be reused before they are refreshed. */
  currentConditionsMs: number;
  /** How long the daily forecast may be reused before it is refreshed. */
  forecastMs: number;
}

export type WeatherUnits = "imperial" | "metric";

export interface CurrentConditions {
  observedAt: string;
  temperature: number;
  weatherCode: number;
  cloudCover: number;
  precipitation: number;
  windSpeed: number;
  windDirection: number;
}

export interface DailyForecast {
  date: string;
  weatherCode: number;
  temperatureHigh: number;
  temperatureLow: number;
  cloudCover: number;
  precipitationProbability: number;
  precipitationTotal: number;
}

export interface WeatherSnapshot {
  current: CurrentConditions;
  forecast: DailyForecast[];
  currentUpdatedAt: Date;
  forecastUpdatedAt: Date;
}

export class WeatherService {
  private currentCache = new Map<string, Cached<CurrentConditions>>();
  private forecastCache = new Map<string, Cached<DailyForecast[]>>();
  private currentRequests = new Map<string, Promise<Cached<CurrentConditions>>>();
  private forecastRequests = new Map<string, Promise<Cached<DailyForecast[]>>>();

  constructor(
    private readonly updateFrequency: WeatherUpdateFrequency,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {
    validateFrequency(updateFrequency);
  }

  async getWeather(location: WeatherLocation, units: WeatherUnits): Promise<WeatherSnapshot> {
    validateLocation(location);
    const key = cacheKey(location, units);
    const [current, forecast] = await Promise.all([
      this.getCurrent(key, location, units),
      this.getForecast(key, location, units)
    ]);
    return {
      current: current.value,
      forecast: forecast.value,
      currentUpdatedAt: current.updatedAt,
      forecastUpdatedAt: forecast.updatedAt
    };
  }

  private async getCurrent(key: string, location: WeatherLocation, units: WeatherUnits): Promise<Cached<CurrentConditions>> {
    const cached = this.currentCache.get(key);
    if (cached && !isExpired(cached, this.updateFrequency.currentConditionsMs, this.now())) return cached;
    const request = this.currentRequests.get(key) ?? this.fetchCurrent(key, location, units, cached);
    return request;
  }

  private async getForecast(key: string, location: WeatherLocation, units: WeatherUnits): Promise<Cached<DailyForecast[]>> {
    const cached = this.forecastCache.get(key);
    if (cached && !isExpired(cached, this.updateFrequency.forecastMs, this.now())) return cached;
    const request = this.forecastRequests.get(key) ?? this.fetchForecast(key, location, units, cached);
    return request;
  }

  private async fetchCurrent(key: string, location: WeatherLocation, units: WeatherUnits, stale: Cached<CurrentConditions> | undefined): Promise<Cached<CurrentConditions>> {
    const request = this.requestCurrent(location, units)
      .then((value) => ({ value, updatedAt: this.now() }))
      .then((cached) => { this.currentCache.set(key, cached); return cached; })
      .catch((error: unknown) => {
        if (stale) return stale;
        throw error;
      })
      .finally(() => this.currentRequests.delete(key));
    this.currentRequests.set(key, request);
    return request;
  }

  private async fetchForecast(key: string, location: WeatherLocation, units: WeatherUnits, stale: Cached<DailyForecast[]> | undefined): Promise<Cached<DailyForecast[]>> {
    const request = this.requestForecast(location, units)
      .then((value) => ({ value, updatedAt: this.now() }))
      .then((cached) => { this.forecastCache.set(key, cached); return cached; })
      .catch((error: unknown) => {
        if (stale) return stale;
        throw error;
      })
      .finally(() => this.forecastRequests.delete(key));
    this.forecastRequests.set(key, request);
    return request;
  }

  private async requestCurrent(location: WeatherLocation, units: WeatherUnits): Promise<CurrentConditions> {
    const url = forecastUrl(location, units);
    url.searchParams.set("current", "temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m");
    const payload = await fetchJson(this.fetcher, url);
    const current = record(payload.current, "current conditions");
    return {
      observedAt: string(current.time, "current.time"),
      temperature: number(current.temperature_2m, "current.temperature_2m"),
      weatherCode: number(current.weather_code, "current.weather_code"),
      cloudCover: number(current.cloud_cover, "current.cloud_cover"),
      precipitation: number(current.precipitation, "current.precipitation"),
      windSpeed: number(current.wind_speed_10m, "current.wind_speed_10m"),
      windDirection: number(current.wind_direction_10m, "current.wind_direction_10m")
    };
  }

  private async requestForecast(location: WeatherLocation, units: WeatherUnits): Promise<DailyForecast[]> {
    const url = forecastUrl(location, units);
    url.searchParams.set("forecast_days", "5");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,cloud_cover_mean,precipitation_probability_max,precipitation_sum");
    const payload = await fetchJson(this.fetcher, url);
    const daily = record(payload.daily, "daily forecast");
    const dates = values(daily.time, "daily.time");
    const weatherCodes = values(daily.weather_code, "daily.weather_code");
    const highs = values(daily.temperature_2m_max, "daily.temperature_2m_max");
    const lows = values(daily.temperature_2m_min, "daily.temperature_2m_min");
    const cloudCover = values(daily.cloud_cover_mean, "daily.cloud_cover_mean");
    const precipitationProbability = values(daily.precipitation_probability_max, "daily.precipitation_probability_max");
    const precipitationTotal = values(daily.precipitation_sum, "daily.precipitation_sum");
    const fields = [weatherCodes, highs, lows, cloudCover, precipitationProbability, precipitationTotal];
    if (dates.length !== 5 || fields.some((field) => field.length !== dates.length)) throw new Error("Open-Meteo returned an incomplete daily forecast.");
    return dates.map((date, index) => ({
      date: string(date, `daily.time[${index}]`),
      weatherCode: number(weatherCodes[index], `daily.weather_code[${index}]`),
      temperatureHigh: number(highs[index], `daily.temperature_2m_max[${index}]`),
      temperatureLow: number(lows[index], `daily.temperature_2m_min[${index}]`),
      cloudCover: number(cloudCover[index], `daily.cloud_cover_mean[${index}]`),
      precipitationProbability: number(precipitationProbability[index], `daily.precipitation_probability_max[${index}]`),
      precipitationTotal: number(precipitationTotal[index], `daily.precipitation_sum[${index}]`)
    }));
  }
}

interface Cached<T> { value: T; updatedAt: Date; }

function forecastUrl(location: WeatherLocation, units: WeatherUnits): URL {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", location.timeZone);
  url.searchParams.set("temperature_unit", units === "imperial" ? "fahrenheit" : "celsius");
  url.searchParams.set("wind_speed_unit", units === "imperial" ? "mph" : "kmh");
  url.searchParams.set("precipitation_unit", units === "imperial" ? "inch" : "mm");
  return url;
}

async function fetchJson(fetcher: typeof fetch, url: URL): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(10_000) }); } catch { throw new Error("Weather data is unavailable."); }
  if (!response.ok) throw new Error(`Weather data request failed (${response.status.toString()}).`);
  return record(await response.json(), "weather response");
}

function cacheKey(location: WeatherLocation, units: WeatherUnits): string { return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)},${location.timeZone},${units}`; }
function isExpired<T>(cached: Cached<T>, maxAgeMs: number, now: Date): boolean { return now.getTime() - cached.updatedAt.getTime() >= maxAgeMs; }
function validateFrequency(value: WeatherUpdateFrequency): void { if (!Number.isSafeInteger(value.currentConditionsMs) || value.currentConditionsMs <= 0 || !Number.isSafeInteger(value.forecastMs) || value.forecastMs <= 0) throw new Error("Weather update frequencies must be positive whole milliseconds."); }
function validateLocation(value: WeatherLocation): void { if (!Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90 || !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180 || !value.timeZone) throw new Error("A valid weather location and time zone are required."); }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Open-Meteo returned invalid ${label}.`); return value as Record<string, unknown>; }
function values(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`Open-Meteo returned invalid ${label}.`); return value; }
function number(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Open-Meteo returned invalid ${label}.`); return value; }
function string(value: unknown, label: string): string { if (typeof value !== "string" || !value) throw new Error(`Open-Meteo returned invalid ${label}.`); return value; }
