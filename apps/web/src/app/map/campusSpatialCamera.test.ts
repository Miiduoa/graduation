import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPATIAL_BEARING,
  MAX_SPATIAL_ZOOM,
  MIN_SPATIAL_ZOOM,
  normalizeSpatialCamera,
  spatialCameraDirection,
  spatialNorthRotationDegrees,
} from './campusSpatialCamera';

describe('spatial camera values shared with the toolbar', () => {
  it('preserves the initial oblique view and normal scale without loading a renderer', () => {
    expect(normalizeSpatialCamera()).toEqual({ bearing: DEFAULT_SPATIAL_BEARING, zoom: 1 });
    const direction = spatialCameraDirection(DEFAULT_SPATIAL_BEARING, false);
    const length = Math.hypot(0.5, 0.94, 1);
    expect(direction.x).toBeCloseTo(0.5 / length, 12);
    expect(direction.y).toBeCloseTo(0.94 / length, 12);
    expect(direction.z).toBeCloseTo(1 / length, 12);
  });

  it('wraps rotation and bounds zoom while rejecting nonfinite camera values', () => {
    expect(normalizeSpatialCamera({ bearing: -30, zoom: 0 })).toEqual({ bearing: 330, zoom: MIN_SPATIAL_ZOOM });
    expect(normalizeSpatialCamera({ bearing: 750, zoom: 100 })).toEqual({ bearing: 30, zoom: MAX_SPATIAL_ZOOM });
    expect(normalizeSpatialCamera({ bearing: -720, zoom: 1 })).toEqual({ bearing: 0, zoom: 1 });
    expect(normalizeSpatialCamera({ bearing: NaN, zoom: Infinity })).toEqual(normalizeSpatialCamera());
    expect(normalizeSpatialCamera({ bearing: Infinity, zoom: NaN })).toEqual(normalizeSpatialCamera());
  });

  it.each([false, true])('keeps north-up and cardinal compass directions consistent with overhead=%s', (overhead) => {
    for (const bearing of [0, 90, 180, 270]) {
      expect(spatialNorthRotationDegrees(bearing, overhead)).toBeCloseTo(bearing, 10);
      const direction = spatialCameraDirection(bearing, overhead);
      expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12);
      expect(direction.y).toBeGreaterThan(0);
    }
    const north = spatialCameraDirection(0, overhead);
    expect(north.x).toBe(0);
    expect(north.z).toBeGreaterThan(0);
  });

  it('accounts for the oblique projection instead of presenting bearing as a flat compass angle', () => {
    expect(spatialNorthRotationDegrees(45, false)).toBeGreaterThan(45);
    expect(spatialNorthRotationDegrees(45, true)).toBeCloseTo(45, 4);
    expect(spatialNorthRotationDegrees(-315, false)).toBe(spatialNorthRotationDegrees(45, false));
  });
});
