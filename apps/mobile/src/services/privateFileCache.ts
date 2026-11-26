import * as FileSystem from 'expo-file-system/legacy';

export async function cachePrivateBlob(
  blob: Blob,
  filename: string,
): Promise<{ uri: string; dispose: () => Promise<void> }> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('無法讀取檔案'));
    reader.readAsDataURL(blob);
  });
  if (!FileSystem.cacheDirectory) throw new Error('暫時無法儲存檔案');
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uri = `${FileSystem.cacheDirectory}private-${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri, dispose: () => FileSystem.deleteAsync(uri, { idempotent: true }) };
}
