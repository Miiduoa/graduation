/** Camera controls are shared with the HTML toolbar without loading Three.js. */
export type CampusSpatialCamera = { bearing: number; zoom: number };

export const DEFAULT_SPATIAL_BEARING = Math.atan2(0.5, 1) * 180 / Math.PI;
export const MIN_SPATIAL_ZOOM = 0.65;
export const MAX_SPATIAL_ZOOM = 2.5;
export const SPATIAL_ZOOM_FACTOR = 1.25;
export const SPATIAL_ROTATION_STEP = 30;

function wrapDegrees(degrees: number) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped === 0 ? 0 : wrapped;
}

export function normalizeSpatialCamera(camera: Partial<CampusSpatialCamera> = {}): CampusSpatialCamera {
  const bearing = typeof camera.bearing === 'number' && Number.isFinite(camera.bearing)
    ? camera.bearing : DEFAULT_SPATIAL_BEARING;
  const zoom = typeof camera.zoom === 'number' && Number.isFinite(camera.zoom) ? camera.zoom : 1;
  return {
    bearing: wrapDegrees(bearing),
    zoom: Math.max(MIN_SPATIAL_ZOOM, Math.min(MAX_SPATIAL_ZOOM, zoom)),
  };
}

/** Offset from the target to the camera. Bearing zero keeps geographic north at the top. */
export function spatialCameraDirection(bearing: number, overhead: boolean) {
  const radians = normalizeSpatialCamera({ bearing }).bearing * Math.PI / 180;
  const horizontal = overhead ? 0.001 : Math.hypot(0.5, 1);
  const vertical = overhead ? 1 : 0.94;
  const length = Math.hypot(horizontal, vertical);
  return {
    x: Math.sin(radians) * horizontal / length,
    y: vertical / length,
    z: Math.cos(radians) * horizontal / length,
  };
}

/** Screen direction of north; oblique projection is not a simple rotation by bearing. */
export function spatialNorthRotationDegrees(bearing: number, overhead: boolean) {
  const normalized = normalizeSpatialCamera({ bearing }).bearing;
  const radians = normalized * Math.PI / 180;
  const direction = spatialCameraDirection(normalized, overhead);
  const degrees = Math.atan2(Math.sin(radians), direction.y * Math.cos(radians)) * 180 / Math.PI;
  return wrapDegrees(degrees);
}
