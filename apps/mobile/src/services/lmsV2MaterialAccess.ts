type MaterialReference = {
  external_url?: string | null;
  storage_path?: string | null;
};
type SignedUrlResponse = { data?: { signedUrl?: string } | null; error?: unknown };
type Signer = (path: string, seconds: number) => Promise<SignedUrlResponse>;

function requireHttps(value: string): string {
  const address = new URL(value);
  if (address.protocol !== 'https:') throw new Error('教材連結必須使用 HTTPS');
  return address.toString();
}

/** A private Storage path is not a browser URL. Authorize short-lived links per open. */
export async function resolveLmsMaterialUrl(
  material: MaterialReference,
  courseId: string,
  sign: Signer,
): Promise<string> {
  if (material.external_url) return requireHttps(material.external_url);
  const path = material.storage_path;
  if (!path) throw new Error('尚未提供教材檔案');
  if (!courseId || !path.startsWith(`${courseId}/`) || path.includes('..')) {
    throw new Error('教材檔案位置不屬於目前課程');
  }
  const signed = await sign(path, 60);
  if (signed.error || !signed.data?.signedUrl) throw new Error('無法取得授權下載連結');
  return requireHttps(signed.data.signedUrl);
}
