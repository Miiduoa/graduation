import { distanceMeters, type CampusCoordinate } from '@campus/shared/src/campusGeo';

type RouteGeometry = { distance: number; geometry: [number, number][] };

export function isUsableFootRoute(
  route: RouteGeometry | null,
  origin: CampusCoordinate,
  destination: CampusCoordinate,
): route is RouteGeometry {
  if (!route || !Number.isFinite(route.distance) || route.distance <= 0 ||
      route.distance > 5000 || !Array.isArray(route.geometry) || route.geometry.length < 2) return false;
  const valid = (pair: unknown) => {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [lng, lat] = pair;
    return typeof lng === 'number' && typeof lat === 'number' &&
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  };
  if (!route.geometry.every(valid)) return false;
  const start = route.geometry[0];
  const end = route.geometry[route.geometry.length - 1];
  return distanceMeters(origin, { lat: start[1], lng: start[0] }) <= 350 &&
    distanceMeters(destination, { lat: end[1], lng: end[0] }) <= 350;
}
