/** Weather via Open-Meteo (free, no API key). */
import { tool } from "ai";
import { z } from "zod";

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "heavy freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

export const weatherTools = {
  get_weather: tool({
    description: "Get current weather and a 3-day forecast for any city or place.",
    inputSchema: z.object({
      location: z.string().describe("City or place name, e.g. 'Bengaluru' or 'Austin, Texas'."),
      units: z.enum(["metric", "imperial"]).default("metric").describe("Use imperial for US users unless they say otherwise."),
    }),
    execute: async ({ location, units }) => {
      try {
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.split(",")[0]!.trim())}&count=5&language=en`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const geo = (await geoRes.json()) as any;
        const places: any[] = geo.results ?? [];
        if (!places.length) return { error: `Couldn't find a place called '${location}'.` };
        const hint = location.split(",").slice(1).join(" ").trim().toLowerCase();
        const place = (hint && places.find((p) => `${p.admin1 ?? ""} ${p.country ?? ""}`.toLowerCase().includes(hint))) || places[0];

        const imperial = units === "imperial";
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=auto&forecast_days=3` +
          (imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "");
        const w = (await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json()) as any;
        const t = imperial ? "°F" : "°C";
        const wind = imperial ? "mph" : "km/h";
        return {
          place: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
          now: {
            conditions: WMO[w.current.weather_code] ?? "unknown",
            temp: `${Math.round(w.current.temperature_2m)}${t}`,
            feelsLike: `${Math.round(w.current.apparent_temperature)}${t}`,
            humidity: `${w.current.relative_humidity_2m}%`,
            wind: `${Math.round(w.current.wind_speed_10m)} ${wind}`,
          },
          forecast: w.daily.time.map((d: string, i: number) => ({
            date: d,
            conditions: WMO[w.daily.weather_code[i]] ?? "unknown",
            high: `${Math.round(w.daily.temperature_2m_max[i])}${t}`,
            low: `${Math.round(w.daily.temperature_2m_min[i])}${t}`,
            rainChance: `${w.daily.precipitation_probability_max[i] ?? 0}%`,
          })),
        };
      } catch (e) {
        return { error: `Weather lookup failed: ${(e as Error).message}` };
      }
    },
  }),
};
