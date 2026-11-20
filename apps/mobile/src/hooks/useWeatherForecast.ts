import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import {
  PROVIDENCE_CAMPUS_LATITUDE,
  PROVIDENCE_CAMPUS_LONGITUDE,
  fetchWeatherForecastBundle,
  type WeatherCoordsSource,
  type WeatherForecastBundle,
} from '../services/weather';
import type { UserPreferences } from '../state/preferences';

export type WeatherPrefsSlice = Pick<
  UserPreferences,
  'weatherUseDeviceLocation' | 'weatherManualLatitude' | 'weatherManualLongitude'
>;

export type WeatherForecastState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; bundle: WeatherForecastBundle }
  | { status: 'error'; message: string };

async function resolveCoordinates(prefs: WeatherPrefsSlice): Promise<{
  latitude: number;
  longitude: number;
  source: WeatherCoordsSource;
}> {
  if (prefs.weatherUseDeviceLocation) {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== Location.PermissionStatus.GRANTED) {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status === Location.PermissionStatus.GRANTED) {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          source: 'device',
        };
      }
    } catch {
      /* fallback below */
    }
  }

  const lat = prefs.weatherManualLatitude;
  const lon = prefs.weatherManualLongitude;
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    return { latitude: lat, longitude: lon, source: 'manual' };
  }

  return {
    latitude: PROVIDENCE_CAMPUS_LATITUDE,
    longitude: PROVIDENCE_CAMPUS_LONGITUDE,
    source: 'campus_default',
  };
}

/**
 * 在天氣相關偏好開啟時解析座標並抓取 Open-Meteo（記憶體快取 + TTL）。
 */
export function useWeatherForecast(enabled: boolean, prefs: WeatherPrefsSlice): {
  state: WeatherForecastState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<WeatherForecastState>({ status: 'idle' });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const fetchGen = useRef(0);

  const prefsKey = useMemo(
    () =>
      `${prefs.weatherUseDeviceLocation ? 'gps' : 'nogps'}:${prefs.weatherManualLatitude ?? ''}:${prefs.weatherManualLongitude ?? ''}`,
    [
      prefs.weatherManualLatitude,
      prefs.weatherManualLongitude,
      prefs.weatherUseDeviceLocation,
    ],
  );

  const load = useCallback(async () => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const gen = ++fetchGen.current;
    setState({ status: 'loading' });

    try {
      const { latitude, longitude, source } = await resolveCoordinates(prefsRef.current);
      const bundle = await fetchWeatherForecastBundle({
        latitude,
        longitude,
        coordsSource: source,
      });
      if (gen !== fetchGen.current) return;
      setState({ status: 'ready', bundle });
    } catch (e) {
      if (gen !== fetchGen.current) return;
      const message = e instanceof Error ? e.message : '無法載入天氣';
      setState({ status: 'error', message });
    }
  }, [enabled, prefsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const gen = ++fetchGen.current;
    setState({ status: 'loading' });
    try {
      const { latitude, longitude, source } = await resolveCoordinates(prefsRef.current);
      const bundle = await fetchWeatherForecastBundle({
        latitude,
        longitude,
        coordsSource: source,
        bypassCache: true,
      });
      if (gen !== fetchGen.current) return;
      setState({ status: 'ready', bundle });
    } catch (e) {
      if (gen !== fetchGen.current) return;
      const message = e instanceof Error ? e.message : '無法載入天氣';
      setState({ status: 'error', message });
    }
  }, [enabled, prefsKey]);

  return { state, refresh };
}
