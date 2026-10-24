'use strict';

/**
 * crawler/sources/weather.js — kick-off weather from Open-Meteo (free, no key).
 *
 *   1. the venue city (from the ESPN match summary) is geocoded once and cached for 30 days
 *   2. the hourly forecast is read for the kick-off hour (temperature, rain, wind, weather code)
 *
 * Weather is CONTEXT, not a model input: the research archive has no historical weather, so
 * its effect could not be measured. It is shown with that label, and only extreme conditions
 * (heavy rain, gales, snow, extreme heat) raise a caution flag.
 */

const HTTP = require('../http');

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FC = 'https://api.open-meteo.com/v1/forecast';

const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};

async function geocode(city, country) {
  if (!city) return null;
  const url = `${GEO}?name=${encodeURIComponent(city)}&count=5&language=en&format=json`;
  const r = await HTTP.get(url, { type: 'json', ttl: 30 * 24 * 3600 * 1000 });
  const res = r.ok && r.body && Array.isArray(r.body.results) ? r.body.results : [];
  if (!res.length) return null;
  const c = String(country || '').toLowerCase();
  const pick = (c && res.find((x) => String(x.country || '').toLowerCase() === c || String(x.country_code || '').toLowerCase() === c)) || res[0];
  return { name: pick.name, lat: pick.latitude, lon: pick.longitude, country: pick.country || null };
}

/** Pure: pick the kick-off hour out of an Open-Meteo hourly block. */
function atHour(hourly, kickoffISO) {
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return null;
  const t = Date.parse(kickoffISO);
  let best = -1;
  let bestD = Infinity;
  hourly.time.forEach((s, i) => {
    const d = Math.abs(Date.parse(s.length === 16 ? s + ':00Z' : s) - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0 || bestD > 3 * 3600 * 1000) return null;
  const v = (k) => (hourly[k] ? hourly[k][best] : null);
  const out = {
    time: hourly.time[best],
    tempC: v('temperature_2m'),
    precipMm: v('precipitation'),
    precipProb: v('precipitation_probability'),
    windKmh: v('wind_speed_10m'),
    gustKmh: v('wind_gusts_10m'),
    code: v('weather_code'),
  };
  out.description = WMO[out.code] || null;
  const flags = [];
  if (out.precipMm != null && out.precipMm >= 4) flags.push('heavy rain');
  if (out.windKmh != null && out.windKmh >= 40) flags.push('strong wind');
  if (out.gustKmh != null && out.gustKmh >= 65) flags.push('gale-force gusts');
  if ([71, 73, 75, 77, 85, 86].includes(out.code)) flags.push('snow');
  if (out.tempC != null && out.tempC >= 32) flags.push('extreme heat');
  if (out.tempC != null && out.tempC <= -5) flags.push('freezing');
  if ([95, 96, 99].includes(out.code)) flags.push('thunderstorm');
  out.flags = flags;
  return out;
}

/**
 * @param {{city?:string, country?:string}} venue
 * @param {string} kickoffISO
 */
async function forKickoff(venue, kickoffISO) {
  try {
    if (!venue || !venue.city || !kickoffISO) return null;
    const ko = Date.parse(kickoffISO);
    if (!Number.isFinite(ko) || ko - Date.now() > 15 * 86400000 || Date.now() - ko > 86400000) return null;
    const g = await geocode(venue.city, venue.country);
    if (!g) return null;
    const day = new Date(ko).toISOString().slice(0, 10);
    const url = `${FC}?latitude=${g.lat.toFixed(3)}&longitude=${g.lon.toFixed(3)}`
      + '&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code'
      + `&timezone=UTC&start_date=${day}&end_date=${day}`;
    const r = await HTTP.get(url, { type: 'json', ttl: 2 * 3600 * 1000 });
    if (!r.ok || !r.body) return null;
    const w = atHour(r.body.hourly, kickoffISO);
    return w ? { ...w, place: g.name, country: g.country, source: 'open-meteo.com', stale: !!r.stale } : null;
  } catch {
    return null;
  }
}

module.exports = { forKickoff, geocode, atHour, WMO };
