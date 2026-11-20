export type CampusCoordinate = { lat: number; lng: number };

export function distanceMeters(start: CampusCoordinate, end: CampusCoordinate): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(end.lat - start.lat);
  const longitude = radians(end.lng - start.lng);
  const arc =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(start.lat)) *
      Math.cos(radians(end.lat)) *
      Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} 公尺`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

/** A median center keeps one distant building from moving the initial campus viewport. */
export function centerOfCoordinates(places: readonly CampusCoordinate[]): CampusCoordinate | null {
  const valid = places.filter(
    ({ lat, lng }) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180,
  );
  if (!valid.length) return null;
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  return {
    lat: median(valid.map((point) => point.lat)),
    lng: median(valid.map((point) => point.lng)),
  };
}
