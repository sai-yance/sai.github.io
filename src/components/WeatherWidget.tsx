import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ArrowClockwise20Regular,
  Cloud20Filled,
  Drop20Filled,
  Flash20Filled,
  Navigation20Regular,
  Search20Regular,
  WeatherMoon20Filled,
  WeatherSunny20Filled,
  WeatherSunny20Regular,
} from '@fluentui/react-icons';
import type { AppSettings } from '../lib/types';
import { fetchWeatherByCoords, geocodeCity, geolocate, type IconKind, type WeatherBundle } from '../lib/weather';
import { fmtTimeShort, load, save, toast } from '../lib/store';
import { EmptyState, Spinner, WidgetShell } from './chrome';

export function WeatherIcon({ kind, night, size = 20 }: { kind: IconKind; night?: boolean; size?: number }) {
  const style = { width: size, height: size };
  if (kind === 'sun') return <WeatherSunny20Filled style={style} primaryFill="var(--warn)" />;
  if (kind === 'moon') return <WeatherMoon20Filled style={style} primaryFill="var(--ac-text)" />;
  if (kind === 'partly')
    return (
      <span className="relative inline-block" style={style}>
        {night ? <WeatherMoon20Filled style={style} primaryFill="var(--ac-text)" /> : <WeatherSunny20Filled style={style} primaryFill="var(--warn)" />}
        <Cloud20Filled style={{ width: size * 0.62, height: size * 0.62, position: 'absolute', right: -size * 0.12, bottom: -size * 0.08 }} primaryFill="var(--text2)" />
      </span>
    );
  if (kind === 'rain' || kind === 'drizzle') return <Drop20Filled style={style} primaryFill="var(--ac-text)" />;
  if (kind === 'thunder') return <Flash20Filled style={style} primaryFill="var(--warn)" />;
  return <Cloud20Filled style={style} primaryFill="var(--text2)" />;
}

interface SavedLoc {
  lat: number;
  lon: number;
  name?: string;
}

export function WeatherWidget({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}) {
  const [bundle, setBundle] = useState<WeatherBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [searching, setSearching] = useState(false);
  const runId = useRef(0);

  const loadWeather = useCallback(
    async (coords?: SavedLoc, cityName?: string) => {
      const id = ++runId.current;
      setLoading(true);
      setError(null);
      try {
        let c: SavedLoc | undefined = coords;
        let chosenCity = cityName;
        if (!c) {
          if (settings.weatherLocation) {
            const g = await geocodeCity(settings.weatherLocation, settings.openWeatherKey);
            if (!g) throw new Error(`City “${settings.weatherLocation}” was not found`);
            c = { lat: g.lat, lon: g.lon, name: g.name };
            chosenCity = settings.weatherLocation;
          } else {
            const cached = load<SavedLoc | null>('dash.weather.loc', null);
            if (cached) c = cached;
            else {
              const pos = await geolocate();
              c = { lat: pos.lat, lon: pos.lon };
            }
          }
        }
        const b = await fetchWeatherByCoords(c.lat, c.lon, settings.openWeatherKey, c.name);
        if (id !== runId.current) return;
        setBundle(b);
        save('dash.weather.loc', { lat: c.lat, lon: c.lon, name: c.name ?? b.place });
        if (chosenCity != null && chosenCity !== settings.weatherLocation) {
          setSettings((s) => ({ ...s, weatherLocation: chosenCity! }));
        }
      } catch (e) {
        if (id !== runId.current) return;
        setError(e instanceof Error ? e.message : 'Could not load weather');
      } finally {
        if (id === runId.current) setLoading(false);
      }
    },
    [settings.weatherLocation, settings.openWeatherKey, setSettings],
  );

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

  useEffect(() => {
    const id = setInterval(() => loadWeather(), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadWeather]);

  const searchCity = async () => {
    const q = city.trim();
    if (!q) return;
    setSearching(true);
    try {
      const g = await geocodeCity(q, settings.openWeatherKey);
      if (!g) {
        toast(`City “${q}” was not found`, 'error');
        return;
      }
      setSettings((s) => ({ ...s, weatherLocation: q }));
      await loadWeather({ lat: g.lat, lon: g.lon, name: g.name }, q);
      setCity('');
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = async () => {
    try {
      const pos = await geolocate();
      setSettings((s) => ({ ...s, weatherLocation: '' }));
      await loadWeather({ lat: pos.lat, lon: pos.lon }, '');
      toast('Using your current location', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Location unavailable', 'error');
    }
  };

  const dayName = (dateStr: string, i: number) => {
    if (i === 0) return 'Today';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString([], { weekday: 'short' });
  };

  return (
    <WidgetShell
      title="Weather"
      icon={<WeatherSunny20Regular />}
      actions={
        <>
          {bundle && <span className="chip pointer-events-none !cursor-default">{bundle.source}</span>}
          <button className="btn-icon" title="Refresh weather" aria-label="Refresh weather" onClick={() => loadWeather()}>
            <ArrowClockwise20Regular />
          </button>
        </>
      }
    >
      <div className="flex h-full flex-col overflow-y-auto scroll-thin p-3.5">
        <div className="mb-2.5 flex gap-1.5">
          <div className="relative flex-1">
            <Search20Regular className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text2)]" fontSize={14} />
            <input
              className="input !h-8 !pl-8 !text-xs"
              placeholder="Search city… (Enter)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchCity()}
              aria-label="Search city"
            />
          </div>
          <button className="btn !h-8 !px-2.5 !text-xs" onClick={searchCity} disabled={searching || !city.trim()}>
            {searching ? <Spinner size={13} /> : 'Go'}
          </button>
          <button className="btn-icon !h-8 !w-8" title="Use my location" aria-label="Use my location" onClick={useMyLocation}>
            <Navigation20Regular fontSize={15} />
          </button>
        </div>

        {loading && !bundle && (
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="shimmer h-24 rounded-xl" />
            <div className="shimmer h-16 rounded-xl" />
            <div className="shimmer h-32 rounded-xl" />
            <div className="flex items-center justify-center gap-2 py-2 text-[12px] text-[var(--text2)]">
              <Spinner size={14} /> Fetching forecast…
            </div>
          </div>
        )}

        {error && !bundle && (
          <EmptyState
            icon={<WeatherSunny20Regular />}
            title="Weather unavailable"
            hint={error + (settings.openWeatherKey ? '' : ' — using the keyless Open-Meteo source; add an OpenWeather key in Settings for the official feed.')}
            action={
              <button className="btn btn-accent" onClick={() => loadWeather()}>
                <ArrowClockwise20Regular /> Retry
              </button>
            }
          />
        )}

        {bundle && (
          <div className={loading ? 'opacity-60 transition-opacity' : 'fade-in'}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[12px] font-bold text-[var(--text2)]">{bundle.place}</div>
                <div className="font-display mt-0.5 text-[42px] font-extrabold leading-none tabular-nums">
                  {Math.round(bundle.current.temp)}°
                  <span className="text-[19px] font-bold text-[var(--text2)]">C</span>
                </div>
                <div className="mt-1 text-[12.5px] font-semibold capitalize">{bundle.current.desc}</div>
                <div className="text-[11px] text-[var(--text2)]">
                  H {Math.round(bundle.daily[0]?.max ?? bundle.current.temp)}° · L {Math.round(bundle.daily[0]?.min ?? bundle.current.temp)}°
                </div>
              </div>
              <div className="pt-1">
                <WeatherIcon kind={bundle.current.kind} night={bundle.current.night} size={56} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {[
                ['Feels', `${Math.round(bundle.current.feels)}°`],
                ['Humidity', `${bundle.current.humidity}%`],
                ['Wind', `${Math.round(bundle.current.wind)} km/h`],
                ['Pressure', `${Math.round(bundle.current.pressure)}`],
                ['UV index', bundle.uv != null ? String(Math.round(bundle.uv * 10) / 10) : '—'],
                ['Air', bundle.aqi ?? '—'],
                ['Sunrise', bundle.current.sunrise ? fmtTimeShort(new Date(bundle.current.sunrise)) : '—'],
                ['Sunset', bundle.current.sunset ? fmtTimeShort(new Date(bundle.current.sunset)) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-[var(--card-hover)] px-2 py-1.5 text-center">
                  <div className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--text2)]">{k}</div>
                  <div className="mt-0.5 truncate text-[11.5px] font-bold tabular-nums" title={String(v)}>{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--text2)]">Next hours</div>
              <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-1">
                {bundle.hourly.map((h) => (
                  <div key={h.t} className="flex shrink-0 flex-col items-center gap-1 rounded-lg bg-[var(--card-hover)] px-2.5 py-2">
                    <span className="text-[10px] font-semibold text-[var(--text2)]">
                      {new Date(h.t).getHours() === new Date().getHours() ? 'Now' : `${new Date(h.t).getHours()}h`}
                    </span>
                    <WeatherIcon kind={h.kind} night={h.night} size={17} />
                    <span className="text-[11.5px] font-bold tabular-nums">{Math.round(h.temp)}°</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2.5">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--text2)]">7-day forecast</div>
              <div className="flex flex-col gap-1">
                {bundle.daily.map((d, i) => (
                  <div key={d.date} className="flex items-center gap-2 rounded-lg px-2 py-[5px] hover:bg-[var(--card-hover)]">
                    <span className="w-[46px] text-[12px] font-bold">{dayName(d.date, i)}</span>
                    <WeatherIcon kind={d.kind} size={16} />
                    <span className="min-w-0 flex-1 truncate text-[11px] capitalize text-[var(--text2)]">{d.desc}</span>
                    <span className="text-[12px] font-bold tabular-nums">{Math.round(d.max)}°</span>
                    <span className="w-[34px] text-right text-[12px] tabular-nums text-[var(--text2)]">{Math.round(d.min)}°</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
