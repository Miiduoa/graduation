import type { MapLocation } from './mapService';

const EARTH_RADIUS_METERS = 6_371_008.8;
const RADIANS_PER_DEGREE = Math.PI / 180;
// This view describes one local area. Separate campuses belong on the regular map.
const MAX_LOCAL_RADIUS_METERS = 10_000;

export type CampusSpatialPoint = {
  id: string;
  name: string;
  category: string;
  x: number;
  z: number;
  location: MapLocation;
};

export type CampusSpatialModel = {
  points: CampusSpatialPoint[];
  extent: { width: number; depth: number };
  radius: number;
  excludedCount: number;
  unavailableReason: 'no-locations' | 'area-too-large' | null;
};

function unavailable(
  reason: Exclude<CampusSpatialModel['unavailableReason'], null>,
  excludedCount: number,
): CampusSpatialModel {
  return {
    points: [],
    extent: { width: 0, depth: 0 },
    radius: 0,
    excludedCount,
    unavailableReason: reason,
  };
}

/** Local azimuthal projection in meters: east is +x and north is -z. */
export function buildCampusSpatialModel(locations: readonly MapLocation[]): CampusSpatialModel {
  const seen = new Set<string>();
  const valid: MapLocation[] = [];
  let excludedCount = 0;
  for (const location of locations) {
    if (
      typeof location.id !== 'string' || !location.id.trim() || seen.has(location.id) ||
      typeof location.name !== 'string' || !location.name.trim() ||
      !Number.isFinite(location.lat) || Math.abs(location.lat) > 90 ||
      !Number.isFinite(location.lng) || Math.abs(location.lng) > 180 ||
      // (0, 0) is the common missing-GPS sentinel (Null Island), not a
      // verified campus POI. One such record must not hide nearby places.
      (location.lat === 0 && location.lng === 0)
    ) {
      excludedCount += 1;
      continue;
    }
    seen.add(location.id);
    valid.push(location);
  }
  if (!valid.length) return unavailable('no-locations', excludedCount);

  // A spherical mean also handles places on opposite sides of the date line.
  let meanX = 0;
  let meanY = 0;
  let meanZ = 0;
  for (const location of valid) {
    const lat = location.lat * RADIANS_PER_DEGREE;
    const lng = location.lng * RADIANS_PER_DEGREE;
    meanX += Math.cos(lat) * Math.cos(lng);
    meanY += Math.cos(lat) * Math.sin(lng);
    meanZ += Math.sin(lat);
  }
  if (Math.hypot(meanX, meanY, meanZ) < 1e-8) {
    return unavailable('area-too-large', excludedCount);
  }
  const centerLat = Math.atan2(meanZ, Math.hypot(meanX, meanY));
  const centerLng = Math.atan2(meanY, meanX);
  const sinCenter = Math.sin(centerLat);
  const cosCenter = Math.cos(centerLat);
  const projected: CampusSpatialPoint[] = [];
  for (const location of valid) {
    const lat = location.lat * RADIANS_PER_DEGREE;
    const deltaLng = location.lng * RADIANS_PER_DEGREE - centerLng;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const cosAngle = Math.max(-1, Math.min(1,
      sinCenter * sinLat + cosCenter * cosLat * Math.cos(deltaLng),
    ));
    const angle = Math.acos(cosAngle);
    if (angle * EARTH_RADIUS_METERS > MAX_LOCAL_RADIUS_METERS) {
      return unavailable('area-too-large', excludedCount);
    }
    const scale = angle < 1e-8 ? 1 : angle / Math.sin(angle);
    projected.push({
      id: location.id,
      name: location.name,
      category: location.category,
      x: EARTH_RADIUS_METERS * scale * cosLat * Math.sin(deltaLng),
      z: -EARTH_RADIUS_METERS * scale * (
        cosCenter * sinLat - sinCenter * cosLat * Math.cos(deltaLng)
      ),
      location,
    });
  }

  let west = Infinity;
  let east = -Infinity;
  let north = Infinity;
  let south = -Infinity;
  for (const point of projected) {
    west = Math.min(west, point.x);
    east = Math.max(east, point.x);
    north = Math.min(north, point.z);
    south = Math.max(south, point.z);
  }
  const width = east - west;
  const depth = south - north;
  const centerX = (east + west) / 2;
  const centerZ = (south + north) / 2;
  return {
    points: projected.map((point) => ({ ...point, x: point.x - centerX, z: point.z - centerZ })),
    extent: { width, depth },
    // The minimum only controls the camera and symbol size; it does not move points.
    radius: Math.max(60, Math.hypot(width, depth) / 2),
    excludedCount,
    unavailableReason: null,
  };
}
