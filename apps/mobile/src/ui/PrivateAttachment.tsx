import React, { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { PrivateImage } from './PrivateImage';
import { cachePrivateBlob } from '../services/privateFileCache';
import * as Sharing from 'expo-sharing';
import { isPrivateFileObjectPath, resolvePrivateMedia } from '../services/privateFiles';

export function PrivateAttachment({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    let cached: Awaited<ReturnType<typeof cachePrivateBlob>> | undefined;
    try {
      if (!isPrivateFileObjectPath(path)) {
        await Linking.openURL(path);
        return;
      }
      const media = await resolvePrivateMedia(path);
      if (!(media instanceof Blob)) {
        Alert.alert('附件尚未開放或暫時無法下載');
        return;
      }
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('這台裝置尚未開放檔案分享');
        return;
      }
      cached = await cachePrivateBlob(media, path.split('/').pop() || '附件');
      await Sharing.shareAsync(cached.uri);
    } catch {
      Alert.alert('附件暫時無法下載', '請稍後再試。');
    } finally {
      await cached?.dispose().catch(() => {});
      setBusy(false);
    }
  }
  return (
    <View>
    {/\.(png|jpe?g|webp|gif|avif)$/i.test(path) && <PrivateImage uri={path} style={{ width: 300, height: 220 }} resizeMode="contain" />}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void open()}>
      <Text>{busy ? '下載中…' : path.split('/').pop()}</Text>
    </Pressable>
    </View>
  );
}
