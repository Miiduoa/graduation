/**
 * Open-Meteo 天氣（免 API Key）：https://open-meteo.com/
 * 僅用於客戶端預報展示／雨天提示；不落後端。
 */

export const PROVIDENCE_CAMPUS_LATITUDE = 24.1826;
export const PROVIDENCE_CAMPUS_LONGITUDE = 120.6004;

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** 記憶體快取 TTL（毫秒） */
export const WEATHER_CACHE_TTL_MS = 45 * 60 * 1000;

export type WeatherCoordsSource = 'device' | 'manual' | 'campus_default';

export type WeatherAmbientTone = 'default' | 'clear' | 'cloud' | 'rain';

export type WeatherForecastBundle = {
  fetchedAt: number;
  timezone: string;
  coords: { latitude: number; longitude: number };
  coordsSource: WeatherCoordsSource;
  currentTempC: number | null;
  currentWeatherCode: number | null;
  today: {
    date: string;
    tempMinC: number | null;
    tempMaxC: number | null;
    precipitationProbabilityMax: number | null;
    precipitationSumMm: number | null;
    weatherCode: number | null;
    ambientTone: WeatherAmbientTone;
    rainLikely: boolean;
  };
};

type CacheEntry = {
  expiresAt: number;
  bundle: WeatherForecastBundle;
};

const memoryCache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** WMO weather code — 降雨／雷雨區間（簡化判斷） */
export function isRainishWmoCode(code: number | null | undefined): boolean {
  if (code == null || Number.isNaN(code)) return false;
  const c = Math.round(code);
  return (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99);
}

export function computeRainLikelyToday(args: {
  precipitationProbabilityMax: number | null;
  precipitationSumMm: number | null;
  weatherCode: number | null;
}): boolean {
  const prob = args.precipitationProbabilityMax;
  const sum = args.precipitationSumMm;
  if (prob != null && prob >= 40) return true;
  if (sum != null && sum >= 0.5) return true;
  return isRainishWmoCode(args.weatherCode);
}

export function ambientToneFromWeatherCode(code: number | null): WeatherAmbientTone {
  if (code == null || Number.isNaN(code)) return 'default';
  const c = Math.round(code);
  if (isRainishWmoCode(c)) return 'rain';
  if (c === 0 || c === 1) return 'clear';
  if (c === 2 || c === 3) return 'cloud';
  if ((c >= 45 && c <= 48) || (c >= 51 && c <= 57)) return 'cloud';
  return 'default';
}

/** 簡短中文描述（儀表板用） */
export function shortWeatherLabelZh(code: number | null): string {
  if (code == null || Number.isNaN(code)) return '天氣';
  const c = Math.round(code);
  if (c === 0) return '晴朗';
  if (c === 1) return '大致晴朗';
  if (c === 2) return '多雲';
  if (c === 3) return '陰';
  if (c >= 45 && c <= 48) return '霧／視線不佳';
  if (isRainishWmoCode(c)) return '可能有雨';
  if (c >= 71 && c <= 77) return '降雪';
  if (c >= 95) return '雷雨';
  return '多雲';
}

type OpenMeteoJson = {
  timezone?: string;
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
  };
};

export async function fetchWeatherForecastBundle(args: {
  latitude: number;
  longitude: number;
  coordsSource: WeatherCoordsSource;
  ttlMs?: number;
  bypassCache?: boolean;
}): Promise<WeatherForecastBundle> {
  const ttl = args.ttlMs ?? WEATHER_CACHE_TTL_MS;
  const key = cacheKey(args.latitude, args.longitude);
  const now = Date.now();

  if (!args.bypassCache) {
    const hit = memoryCache.get(key);
    if (hit && hit.expiresAt > now) {
      return {
        ...hit.bundle,
        coordsSource: args.coordsSource,
        coords: { latitude: args.latitude, longitude: args.longitude },
      };
    }
  }

  const params = new URLSearchParams({
    latitude: String(args.latitude),
    longitude: String(args.longitude),
    current: 'temperature_2m,weather_code',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    forecast_days: '3',
    timezone: 'auto',
  });

  const res = await fetch(`${OPEN_METEO_FORECAST}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const json = (await res.json()) as OpenMeteoJson;
  const tz = typeof json.timezone === 'string' ? json.timezone : 'auto';

  const idx = 0;
  const date = json.daily?.time?.[idx] ?? '';
  const wCode = json.daily?.weather_code?.[idx] ?? null;
  const tMax = json.daily?.temperature_2m_max?.[idx] ?? null;
  const tMin = json.daily?.temperature_2m_min?.[idx] ?? null;
  const pProb = json.daily?.precipitation_probability_max?.[idx] ?? null;
  const pSum = json.daily?.precipitation_sum?.[idx] ?? null;

  const rainLikely = computeRainLikelyToday({
    precipitationProbabilityMax: pProb,
    precipitationSumMm: pSum,
    weatherCode: wCode,
  });

  const curCode = json.current?.weather_code ?? wCode;
  const ambientTone =
    rainLikely ? 'rain' : ambientToneFromWeatherCode(curCode ?? wCode);

  const bundle: WeatherForecastBundle = {
    fetchedAt: now,
    timezone: tz,
    coords: { latitude: args.latitude, longitude: args.longitude },
    coordsSource: args.coordsSource,
    currentTempC:
      typeof json.current?.temperature_2m === 'number'
        ? json.current.temperature_2m
        : null,
    currentWeatherCode: typeof json.current?.weather_code === 'number' ? json.current.weather_code : null,
    today: {
      date,
      tempMinC: typeof tMin === 'number' ? tMin : null,
      tempMaxC: typeof tMax === 'number' ? tMax : null,
      precipitationProbabilityMax: typeof pProb === 'number' ? pProb : null,
      precipitationSumMm: typeof pSum === 'number' ? pSum : null,
      weatherCode: wCode,
      ambientTone,
      rainLikely,
    },
  };

  memoryCache.set(key, { expiresAt: now + ttl, bundle });
  return bundle;
}

export function clearWeatherMemoryCache(): void {
  memoryCache.clear();
}
