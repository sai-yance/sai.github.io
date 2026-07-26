/* Weather: OpenWeather (when an API key is configured) with a keyless Open-Meteo fallback. */

export type IconKind = 'sun' | 'moon' | 'partly' | 'cloud' | 'rain' | 'drizzle' | 'snow' | 'thunder' | 'mist';

export interface CurrentWeather {
  temp: number;
  feels: number;
  humidity: number;
  pressure: number;
  wind: number;
  windDeg: number;
  desc: string;
  kind: IconKind;
  night: boolean;
  sunrise: number;
  sunset: number;
}

export interface HourForecast {
  t: number;
  temp: number;
  kind: IconKind;
  night: boolean;
}

export interface DayForecast {
  date: string;
  min: number;
  max: number;
  kind: IconKind;
  desc: string;
}

export interface WeatherBundle {
  source: 'OpenWeather' | 'Open-Meteo';
  place: string;
  lat: number;
  lon: number;
  current: CurrentWeather;
  hourly: HourForecast[];
  daily: DayForecast[];
  uv: number | null;
  aqi: string | null;
}

const AQI_LABELS: Record<number, string> = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very poor' };

function owKind(icon: string): IconKind {
  const code = icon.slice(0, 2);
  const night = icon.endsWith('n');
  switch (code) {
    case '01': return night ? 'moon' : 'sun';
    case '02': return 'partly';
    case '03':
    case '04': return 'cloud';
    case '09': return 'drizzle';
    case '10': return 'rain';
    case '11': return 'thunder';
    case '13': return 'snow';
    case '50': return 'mist';
    default: return 'cloud';
  }
}

function wmoKind(code: number): IconKind {
  if (code === 0) return 'sun';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'mist';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}

const WMO_DESC: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = j.message;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return res.json();
}

/* ---------- OpenWeather ---------- */

async function fetchOpenWeather(lat: number, lon: number, place: string, key: string): Promise<WeatherBundle> {
  const base = 'https://api.openweathermap.org/data/2.5';
  const [cur, fc, air] = await Promise.all([
    getJson(`${base}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(key)}`),
    getJson(`${base}/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(key)}`),
    getJson(`${base}/air_pollution?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(key)}`).catch(() => null),
  ]);

  const hourly: HourForecast[] = (fc.list ?? []).slice(0, 8).map((it: any) => ({
    t: it.dt * 1000,
    temp: it.main.temp,
    kind: owKind(it.weather?.[0]?.icon ?? '01d'),
    night: String(it.weather?.[0]?.icon ?? '').endsWith('n'),
  }));

  const byDay = new Map<string, { min: number; max: number; kind: IconKind; desc: string }>();
  for (const it of fc.list ?? []) {
    const d = new Date(it.dt * 1000);
    const key2 = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const kind = owKind(it.weather?.[0]?.icon ?? '03d');
    const prev = byDay.get(key2);
    if (!prev) {
      byDay.set(key2, { min: it.main.temp_min, max: it.main.temp_max, kind, desc: it.weather?.[0]?.description ?? '' });
    } else {
      prev.min = Math.min(prev.min, it.main.temp_min);
      prev.max = Math.max(prev.max, it.main.temp_max);
      if (d.getHours() >= 9 && d.getHours() <= 15) {
        prev.kind = kind;
        prev.desc = it.weather?.[0]?.description ?? prev.desc;
      }
    }
  }
  const daily: DayForecast[] = [...byDay.entries()].slice(0, 7).map(([k, v]) => {
    const [y, m, dd] = k.split('-').map(Number);
    const d = new Date(y, m, dd);
    return {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      ...v,
    };
  });

  const sunrise = cur.sys?.sunrise ? cur.sys.sunrise * 1000 : 0;
  const sunset = cur.sys?.sunset ? cur.sys.sunset * 1000 : 0;
  const nowMs = cur.dt * 1000;
  const night = nowMs < sunrise || nowMs > sunset;

  const aqiRaw = air?.list?.[0]?.main?.aqi;
  const uv = await fetchUv(lat, lon);

  return {
    source: 'OpenWeather',
    place,
    lat,
    lon,
    current: {
      temp: cur.main.temp,
      feels: cur.main.feels_like,
      humidity: cur.main.humidity,
      pressure: cur.main.pressure,
      wind: cur.wind?.speed ?? 0,
      windDeg: cur.wind?.deg ?? 0,
      desc: cur.weather?.[0]?.description ?? '',
      kind: owKind(cur.weather?.[0]?.icon ?? '01d'),
      night,
      sunrise,
      sunset,
    },
    hourly,
    daily,
    uv,
    aqi: aqiRaw ? AQI_LABELS[aqiRaw] ?? `AQI ${aqiRaw}` : null,
  };
}

/* ---------- Open-Meteo (keyless fallback) ---------- */

async function fetchOpenMeteo(lat: number, lon: number, place: string): Promise<WeatherBundle> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code,sunrise,sunset',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max',
    timezone: 'auto',
    forecast_days: '8',
  });
  const [j, air] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`),
    getJson(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`,
    ).catch(() => null),
  ]);

  const sunrise = new Date(j.current.sunrise).getTime();
  const sunset = new Date(j.current.sunset).getTime();
  const nowMs = Date.now();
  const night = nowMs < sunrise || nowMs > sunset;

  const hourIdx: number[] = [];
  const times: string[] = j.hourly?.time ?? [];
  const nowIso = new Date(nowMs);
  const nowLocal = `${nowIso.getFullYear()}-${String(nowIso.getMonth() + 1).padStart(2, '0')}-${String(nowIso.getDate()).padStart(2, '0')}T${String(nowIso.getHours()).padStart(2, '0')}:00`;
  let start = times.findIndex((t) => t >= nowLocal);
  if (start < 0) start = 0;
  for (let i = start; i < Math.min(start + 24, times.length); i += 3) hourIdx.push(i);

  const hourly: HourForecast[] = hourIdx.map((i) => {
    const t = new Date(times[i]).getTime();
    return {
      t,
      temp: j.hourly.temperature_2m[i],
      kind: wmoKind(j.hourly.weather_code[i]),
      night: t < sunrise || t > sunset,
    };
  });

  const daily: DayForecast[] = (j.daily?.time ?? []).slice(0, 7).map((date: string, i: number) => ({
    date,
    min: j.daily.temperature_2m_min[i],
    max: j.daily.temperature_2m_max[i],
    kind: wmoKind(j.daily.weather_code[i]),
    desc: WMO_DESC[j.daily.weather_code[i]] ?? '',
  }));

  const aqi = air?.current?.us_aqi;
  const aqiLabel =
    aqi == null ? null : aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy (sensitive)' : aqi <= 200 ? 'Unhealthy' : 'Very unhealthy';

  return {
    source: 'Open-Meteo',
    place,
    lat,
    lon,
    current: {
      temp: j.current.temperature_2m,
      feels: j.current.apparent_temperature,
      humidity: j.current.relative_humidity_2m,
      pressure: j.current.surface_pressure,
      wind: j.current.wind_speed_10m,
      windDeg: j.current.wind_direction_10m ?? 0,
      desc: WMO_DESC[j.current.weather_code] ?? '',
      kind: wmoKind(j.current.weather_code),
      night,
      sunrise,
      sunset,
    },
    hourly,
    daily,
    uv: j.daily?.uv_index_max?.[0] ?? null,
    aqi: aqiLabel,
  };
}

async function fetchUv(lat: number, lon: number): Promise<number | null> {
  try {
    const j = await getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=uv_index_max&timezone=auto&forecast_days=1`,
    );
    return j?.daily?.uv_index_max?.[0] ?? null;
  } catch {
    return null;
  }
}

/* ---------- public entry points ---------- */

export async function fetchWeatherByCoords(lat: number, lon: number, owKey: string, place?: string): Promise<WeatherBundle> {
  const label = place ?? `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  if (owKey) {
    try {
      return await fetchOpenWeather(lat, lon, label, owKey);
    } catch {
      /* fall through to keyless source */
    }
  }
  return fetchOpenMeteo(lat, lon, label);
}

export async function geocodeCity(city: string, owKey: string): Promise<{ lat: number; lon: number; name: string } | null> {
  if (owKey) {
    try {
      const j = await getJson(
        `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${encodeURIComponent(owKey)}`,
      );
      if (j?.[0]) return { lat: j[0].lat, lon: j[0].lon, name: j[0].name + (j[0].country ? `, ${j[0].country}` : '') };
      return null;
    } catch {
      /* fall through */
    }
  }
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  const r = j?.results?.[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, name: r.name + (r.country ? `, ${r.country}` : '') };
}

export function geolocate(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1 ? 'Location permission denied' : 'Could not determine location')),
      { timeout: 10000, maximumAge: 300000 },
    );
  });
}
