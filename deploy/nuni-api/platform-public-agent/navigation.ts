import { createHash } from 'node:crypto';
import { exactRecord, PublicAgentError, type ParsedPublicTask } from './contract';

export type PublicPlace = { id: string; name: string; lat: number; lng: number; sourceUrl: string };
export type PublicCatalog = {
  schoolId: string;
  updatedAt: string;
  label: string;
  places: PublicPlace[];
};
export type PublicCatalogReader = (schoolId: string, signal: AbortSignal) => Promise<PublicCatalog>;
const invalid = (): never => {
  throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
};
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return invalid();
  return value;
}
export function publicSnapshot(raw: unknown, schoolId: string) {
  const row = exactRecord(raw, ['schoolId', 'updatedAt', 'label', 'places']);
  if (row.schoolId !== schoolId || !Array.isArray(row.places) || row.places.length > 200)
    return invalid();
  const updatedAt = text(row.updatedAt, 40),
    label = text(row.label, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)))
    return invalid();
  const ids = new Set<string>();
  const places = row.places
    .map((rawPlace) => {
      const p = exactRecord(rawPlace, ['id', 'name', 'lat', 'lng', 'sourceUrl']);
      const id = text(p.id, 120),
        name = text(p.name, 100),
        sourceUrl = text(p.sourceUrl, 240);
      if (
        !/^[A-Za-z0-9_-]+$/u.test(id) ||
        ids.has(id) ||
        typeof p.lat !== 'number' ||
        !Number.isFinite(p.lat) ||
        Math.abs(p.lat) > 90 ||
        typeof p.lng !== 'number' ||
        !Number.isFinite(p.lng) ||
        Math.abs(p.lng) > 180 ||
        !/^https:\/\/www\.openstreetmap\.org\/(way|node|relation)\/\d+$/u.test(sourceUrl)
      )
        return invalid();
      ids.add(id);
      return Object.freeze({ id, name, lat: p.lat, lng: p.lng, sourceUrl });
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const catalog = { schoolId, updatedAt, label, places };
  return {
    ...catalog,
    fingerprint: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
  };
}
export type PublicSnapshot = ReturnType<typeof publicSnapshot>;
export function exactNavigation(query: string, snapshot: PublicSnapshot) {
  const pairs = snapshot.places.flatMap((from) =>
    snapshot.places
      .filter((to) => to.id !== from.id && query === `從${from.name}到${to.name}`)
      .map((to) => ({ fromId: from.id, toId: to.id })),
  );
  if (pairs.length !== 1) throw new PublicAgentError('PUBLIC_AGENT_DESTINATION_UNCLEAR', 422);
  return pairs[0]!;
}
export function navigationReceipt(task: ParsedPublicTask, snapshot: PublicSnapshot, raw: unknown) {
  const result = exactRecord(raw, ['fromId', 'toId']);
  const expected = exactNavigation(task.data.query as string, snapshot);
  if (result.fromId !== expected.fromId || result.toId !== expected.toId)
    throw new PublicAgentError('PUBLIC_AGENT_INVALID_RESULT', 502);
  const from = snapshot.places.find((p) => p.id === expected.fromId)!;
  const to = snapshot.places.find((p) => p.id === expected.toId)!;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', `${from.lat},${from.lng}`);
  url.searchParams.set('destination', `${to.lat},${to.lng}`);
  url.searchParams.set('travelmode', 'walking');
  return {
    kind: 'walking-route',
    from,
    to,
    url: url.href,
    sourceDate: snapshot.updatedAt,
    sourceLabel: snapshot.label,
    mode: task.binding.provider,
  };
}
