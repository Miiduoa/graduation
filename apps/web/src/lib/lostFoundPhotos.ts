export type LostFoundPhoto = {
  src: string;
  host: string;
  campusHosted: boolean;
};

export function readLostFoundPhotos(imageUrls: unknown, legacyUrl: unknown): LostFoundPhoto[] {
  const values: unknown[] = Array.isArray(imageUrls) ? [...imageUrls, legacyUrl] : [legacyUrl];
  const photos = new Map<string, LostFoundPhoto>();
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  for (const value of values) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.username || url.password) continue;
    url.hash = '';
    if (photos.has(url.href)) continue;
    // Other Firebase buckets can also be owned by third parties.
    const campusHosted =
      Boolean(bucket) &&
      url.origin === 'https://firebasestorage.googleapis.com' &&
      url.pathname.startsWith(`/v0/b/${bucket}/o/`);
    photos.set(url.href, { src: url.href, host: url.host, campusHosted });
  }
  return [...photos.values()];
}
